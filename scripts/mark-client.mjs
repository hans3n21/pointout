import fs from "node:fs";

const file = "dist/index.js";
const source = fs.readFileSync(file, "utf8");
if (!source.startsWith('"use client";')) fs.writeFileSync(file, '"use client";\n' + source);
