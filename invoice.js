const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const PDFDocument = require('pdfkit');

async function generateInvoicePDF(fieldValues) {
    const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless
    });
    const page = await browser.newPage();

    await page.goto('file://' + __dirname + '/invoice-ready3.html', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.getElementById('genForm') && document.getElementById('genForm').children.length > 0, { timeout: 30000 });

    await page.evaluate((values) => {
        Object.keys(values).forEach(key => {
            const input = document.getElementById('val_' + key);
            if (input) {
                input.value = values[key];
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }, fieldValues);

    await new Promise(r => setTimeout(r, 1500));

    const result = await page.evaluate(() => {
        const canvas = document.getElementById('tplCanvas');
        return {
            dataURL: canvas.toDataURL('image/jpeg', 1.0),
            width: canvas.width,
            height: canvas.height
        };
    });

    await browser.close();

    const base64Data = result.dataURL.replace(/^data:image\/jpeg;base64,/, '');
    const imgBuffer = Buffer.from(base64Data, 'base64');

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: [result.width, result.height], margin: 0 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.image(imgBuffer, 0, 0, { width: result.width, height: result.height });
        doc.end();
    });
}

module.exports = { generateInvoicePDF };
