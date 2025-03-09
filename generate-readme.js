const fs = require("fs");

const FILE_PATH = "README.md";

const content = fs.readFileSync(FILE_PATH, "utf8");

const updatedContent = `
🔄 **Updated:** ${new Date().toLocaleString()}

${content}
`;

fs.writeFileSync(FILE_PATH, updatedContent, "utf8");

console.log("✅ README.md was updated!");
