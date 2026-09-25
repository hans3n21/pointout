import fs from "node:fs";
import ts from "typescript";

for (const file of ["src/client/PointOutWidget.tsx", "src/client/PointOutMarkup.tsx"]) {
  const source = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  function addLiteral(node) {
    const value = node.text;
    const prefixed = value.replace(/\S+/g, (token) => token.startsWith("po:") ? token : `po:${token}`);
    if (value !== prefixed) {
      edits.push({ start: node.getStart(tree), end: node.getEnd(), value: JSON.stringify(prefixed) });
    }
  }

  function visitClassExpression(node) {
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) return;
    if (ts.isStringLiteral(node)) { addLiteral(node); return; }
    ts.forEachChild(node, visitClassExpression);
  }

  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === "className" && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) addLiteral(node.initializer);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) visitClassExpression(node.initializer.expression);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  }
  fs.writeFileSync(file, output);
  process.stdout.write(`${file}: ${edits.length} class strings prefixed\n`);
}
