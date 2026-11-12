import fs from "node:fs";
import * as xlsx from "xlsx";

const file = process.argv[2];
const workbook = xlsx.read(fs.readFileSync(file), { type: "buffer", cellDates: true });
for (const sheetName of workbook.SheetNames) {
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: true });
  console.log(`\n=== ${sheetName} ===`);
  rows.forEach((row, index) => {
    const first = String(row[0] ?? "").trim();
    const second = String(row[1] ?? "").trim();
    if (/INNINGS/i.test(first)) console.log(`${index + 1}: ${first}`);
    if (/^BATSMAN$/i.test(second) || /^BOWLER$/i.test(second) || /TOTAL/i.test(first)) {
      console.log(`${index + 1}: ${row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" | ")}`);
    }
    if (index > 2 && second && !/^BATSMAN$|^BOWLER$/i.test(second) && (row[11] != null || row[12] != null)) {
      console.log(`${index + 1}: name=${second} balls=${row[10]} runs=${row[11]} wkts=${row[12]} fours=${row[7]} sixes=${row[8]} status=${row[12]}`);
    }
  });
}
