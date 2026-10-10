const fs = require('fs');
const html = fs.readFileSync('./invoice-ready3.html', 'utf8');
const m = html.match(/<script id="baked-template" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) {
    console.error('Template not found.');
    process.exit(1);
}
fs.writeFileSync('./template.json', m[1]);
console.log('Template extracted to template.json');
