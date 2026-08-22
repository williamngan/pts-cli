import { parse, type Node } from "acorn";

import { PtsRenderError } from "./PtsRenderError.js";

export interface SourceAnalysis {
  readonly classicMarkers: readonly string[];
  readonly hasCommonJsExport: boolean;
  readonly hasModuleSyntax: boolean;
  readonly ptsRuntimeReferences: readonly string[];
}

type AstRecord = Record<string, unknown> & { readonly type: string };

function isAstNode(value: unknown): value is AstRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function memberName(node: unknown): string | undefined {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") {
    return node.name;
  }
  if (node.type !== "MemberExpression" || node.optional === true) {
    return undefined;
  }
  const object = memberName(node.object);
  if (object === undefined) return undefined;
  if (node.computed === false && isAstNode(node.property)) {
    if (
      node.property.type === "Identifier" &&
      typeof node.property.name === "string"
    ) {
      return object + "." + node.property.name;
    }
  }
  if (
    node.computed === true &&
    isAstNode(node.property) &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return object + "." + node.property.value;
  }
  return undefined;
}

function literalString(node: unknown): string | undefined {
  return isAstNode(node) &&
    node.type === "Literal" &&
    typeof node.value === "string"
    ? node.value
    : undefined;
}

function isPtsSpecifier(value: string | undefined): value is string {
  return value === "pts" || value?.startsWith("pts/") === true;
}

function walk(node: Node, visit: (node: AstRecord) => void): void {
  const record = node as unknown as AstRecord;
  visit(record);
  for (const [key, value] of Object.entries(record)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    if (isAstNode(value)) {
      walk(value as unknown as Node, visit);
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isAstNode(item)) walk(item as unknown as Node, visit);
    }
  }
}

function parseSource(source: string, sourcePath: string): Node {
  let moduleError: unknown;
  try {
    return parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch (error) {
    moduleError = error;
  }

  try {
    return parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceType: "script",
    });
  } catch (scriptError) {
    throw new PtsRenderError(
      "SCENE_INVALID",
      "load",
      "Source is not valid JavaScript: " + sourcePath,
      {
        cause: scriptError,
        details: {
          source: sourcePath,
          parserMessage:
            moduleError instanceof Error
              ? moduleError.message
              : String(moduleError),
        },
      },
    );
  }
}

/** Analyze JavaScript syntax without evaluating or importing the source. */
export function analyzeJavaScriptSource(
  source: string,
  sourcePath: string,
): SourceAnalysis {
  const ast = parseSource(source, sourcePath);
  const classicMarkers = new Set<string>();
  const ptsRuntimeReferences = new Set<string>();
  let hasModuleSyntax = false;
  let hasCommonJsExport = false;

  walk(ast, (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportDefaultDeclaration" ||
      node.type === "ExportNamedDeclaration"
    ) {
      hasModuleSyntax = true;
      const specifier = literalString(node.source);
      if (isPtsSpecifier(specifier)) ptsRuntimeReferences.add(specifier);
    }

    if (node.type === "AssignmentExpression") {
      const left = memberName(node.left);
      if (
        left === "module.exports" ||
        left?.startsWith("module.exports.") === true ||
        left?.startsWith("exports.") === true
      ) {
        hasCommonJsExport = true;
      }
      if (
        left === "window.demoDescription" ||
        left === "globalThis.demoDescription"
      ) {
        classicMarkers.add(left);
      }
    }

    if (node.type === "CallExpression") {
      const callee = memberName(node.callee);
      if (callee === "Pts.quickStart") classicMarkers.add(callee);
      if (callee === "Pts.namespace") classicMarkers.add(callee);
      if (callee === "require") {
        const argumentsValue = node.arguments;
        if (Array.isArray(argumentsValue)) {
          const specifier = literalString(argumentsValue[0]);
          if (isPtsSpecifier(specifier)) ptsRuntimeReferences.add(specifier);
        }
      }
    }

    if (node.type === "ImportExpression") {
      const specifier = literalString(node.source);
      if (isPtsSpecifier(specifier)) ptsRuntimeReferences.add(specifier);
    }

    if (node.type === "NewExpression") {
      const callee = memberName(node.callee);
      if (
        callee === "CanvasSpace" ||
        callee === "Pts.CanvasSpace" ||
        callee === "HTMLSpace" ||
        callee === "Pts.HTMLSpace" ||
        callee === "SVGSpace" ||
        callee === "Pts.SVGSpace"
      ) {
        classicMarkers.add("new " + callee);
      }
    }
  });

  return {
    classicMarkers: Object.freeze([...classicMarkers]),
    hasCommonJsExport,
    hasModuleSyntax,
    ptsRuntimeReferences: Object.freeze([...ptsRuntimeReferences]),
  };
}

export function selectAutomaticLoader(
  source: string,
  sourcePath: string,
): "scene" | "pts-demo" {
  const analysis = analyzeJavaScriptSource(source, sourcePath);
  const hasClassicMarkers = analysis.classicMarkers.length > 0;
  const hasExports = analysis.hasModuleSyntax || analysis.hasCommonJsExport;

  if (hasClassicMarkers && hasExports) {
    throw new PtsRenderError(
      "LOADER_AMBIGUOUS",
      "load",
      "Source contains both module exports and classic Pts demo markers",
      {
        details: {
          source: sourcePath,
          classicMarkers: analysis.classicMarkers,
        },
        hint: "Choose explicitly with --loader scene or --loader pts-demo.",
      },
    );
  }
  return hasClassicMarkers ? "pts-demo" : "scene";
}
