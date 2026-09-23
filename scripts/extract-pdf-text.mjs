import fs from "fs";
import { execFileSync } from "child_process";

const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error("Usage: node scripts/extract-pdf-text.mjs <pdf-file>");
  process.exit(1);
}

if (!fs.existsSync(pdfPath)) {
  console.error(`PDF not found: ${pdfPath}`);
  process.exit(1);
}

try {
  const output = execFileSync(
    "pdftotext",
    ["-layout", pdfPath, "-"],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    }
  );

  process.stdout.write(output || "");
} catch (error) {
  console.error(
    `PDF extraction failed: ${error?.message || String(error)}`
  );
  process.exit(1);
}
