const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const { generateInvoicePDF } = require('./invoice.js');
const fs = require('fs');

const token = '8766355964:AAHkloJIQEjCl8uO2pp5eaWqh8ozfANX-ik';

const bot = new Telegraf(token);
const db = new sqlite3.Database('./clients.db');

const userStates = {};

function formatMoney(num) {
    const sign = num < 0 ? '-' : '';
    const abs = Math.abs(num);
    return sign + '₦' + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

console.log("Zoila is waking up...");

bot.start((ctx) => {
    ctx.reply("Hello. I'm Zoila, the personal assistant for Zelzah Couture. I can help you manage your clients and create invoices.\n\nSay 'guide' if you'd like to know everything I can do.");
});

bot.hears(/guide|how to use|how do i use|^help/i, (ctx) => {
    const guide = `*Here's how to use me:*

*Add a client:*
Say: "add client [name]"
Example: "add client Mummy sese"
I'll ask for the phone number, then measurements.

*Find a client:*
Say: "find [name]" or "bring me [name]'s file"
Example: "find Mummy sese"

*Create an invoice:*
Say: "create invoice for [name]"
I'll ask for the full name, description, price, and amount paid.

*View payment history:*
Say: "transactions for [name]"

*Edit a client:*
Say: "edit client [name]"
Then tell me what to update (phone, measurements, or notes).

*Delete a client:*
Say: "delete client [name]"
I'll ask for confirmation.

*Call my name:*
Just say "Zoila" and I'll respond.`;
    ctx.reply(guide, { parse_mode: 'Markdown' });
});

bot.hears(/(add|new|register|create)\s*(a|new|the)?\s*client(s)?\s*(.*)/i, (ctx) => {
    const chatId = ctx.chat.id;
    const providedName = ctx.match[4] ? ctx.match[4].trim() : null;

    if (providedName) {
        userStates[chatId] = { step: 'awaiting_phone', name: providedName };
        ctx.reply("Got it. What is " + providedName + "'s phone number?");
    } else {
        userStates[chatId] = { step: 'awaiting_name' };
        ctx.reply("What is the new client's name?");
    }
});

bot.hears(/create invoice for (.*)/i, (ctx) => {
    const name = ctx.match[1].trim();
    
    db.get(`SELECT * FROM clients WHERE name LIKE ?`, [`%${name}%`], (err, row) => {
        if (err) {
            ctx.reply("I had trouble reading the database.");
        } else if (row) {
            userStates[ctx.chat.id] = { step: 'invoice_client_name', clientName: row.name };
            ctx.reply("Creating invoice for " + row.name + ". \n\nWhat is the full name to print on the invoice?");
        } else {
            ctx.reply("I couldn't find a client named " + name + ". Please add them first.");
        }
    });
});

bot.hears(/(delete|remove) client (.*)/i, (ctx) => {
    const chatId = ctx.chat.id;
    const name = ctx.match[2].trim();
    
    db.get(`SELECT * FROM clients WHERE name LIKE ?`, [`%${name}%`], (err, row) => {
        if (err) {
            ctx.reply("Database error.");
        } else if (row) {
            userStates[chatId] = { step: 'confirm_delete', targetName: row.name };
            ctx.reply("Are you sure you want to permanently delete " + row.name + "? Reply 'yes' to confirm or 'no' to cancel.");
        } else {
            ctx.reply("I couldn't find a client named " + name + ".");
        }
    });
});

bot.hears(/edit client (.*)/i, (ctx) => {
    const chatId = ctx.chat.id;
    const name = ctx.match[1].trim();
    
    db.get(`SELECT * FROM clients WHERE name LIKE ?`, [`%${name}%`], (err, row) => {
        if (err) {
            ctx.reply("Database error.");
        } else if (row) {
            userStates[chatId] = { step: 'edit_field', targetName: row.name };
            ctx.reply("What would you like to update for " + row.name + "? (Phone, Measurements, Notes)");
        } else {
            ctx.reply("I couldn't find a client named " + name + ".");
        }
    });
});

bot.on('text', (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text.toLowerCase();

    if (userStates[chatId]) {
        const state = userStates[chatId].step;

        if (state === 'awaiting_name') {
            userStates[chatId] = { step: 'awaiting_phone', name: ctx.message.text };
            return ctx.reply("Got it. What is " + ctx.message.text + "'s phone number?");
        }
        if (state === 'awaiting_phone') {
            userStates[chatId].phone = ctx.message.text;
            userStates[chatId].step = 'awaiting_measurements';
            return ctx.reply("And what are " + userStates[chatId].name + "'s measurements or notes?");
        }
        if (state === 'awaiting_measurements') {
            const client = userStates[chatId];
            db.run(`INSERT INTO clients (name, phone, measurements, notes) VALUES (?, ?, ?, ?)`, 
                [client.name, client.phone, ctx.message.text, "Added via Telegram"], 
                (err) => {
                    if (err) ctx.reply("I had trouble saving that.");
                    else ctx.reply(client.name + " has been saved to the database.");
                    delete userStates[chatId];
                }
            );
            return;
        }

        if (state === 'invoice_client_name') {
            userStates[chatId].invoiceFullName = ctx.message.text;
            userStates[chatId].step = 'invoice_description';
            return ctx.reply("What is the description? (e.g., 1 bespoke outfit)");
        }
        if (state === 'invoice_description') {
            userStates[chatId].description = ctx.message.text;
            userStates[chatId].step = 'invoice_price';
            return ctx.reply("What is the price?");
        }
        if (state === 'invoice_price') {
            userStates[chatId].price = ctx.message.text;
            userStates[chatId].step = 'invoice_paid';
            return ctx.reply("How much has the client paid so far?");
        }
        if (state === 'invoice_paid') {
            const data = userStates[chatId];
            data.paid = ctx.message.text;
            
            const priceStr = data.price.toString().replace(/[₦,#\s]/g, '');
            const paidStr = data.paid.toString().replace(/[₦,#\s]/g, '');
            
            const priceNum = parseFloat(priceStr) || 0;
            const paidNum = parseFloat(paidStr) || 0;
            const balanceNum = priceNum - paidNum;
            
            const formattedPrice = formatMoney(priceNum);
            const formattedPaid = formatMoney(paidNum);
            const formattedBalance = formatMoney(balanceNum);
            
            ctx.reply("Generating your invoice... this may take a few seconds.");
            
            const fieldValues = {
                'fjag7zq9': data.invoiceFullName || data.clientName,
                'fy3aa7nr': data.description,
                'fxrjeioh': formattedPrice,
                'fcd4bozp': formattedPaid,
                'fb9cukn5': formattedBalance,
                'f7yl0m87': formattedPrice,
                'f60t7z19': formattedBalance,
                'fh95leep': new Date().toLocaleDateString('en-GB')
            };

            generateInvoicePDF(fieldValues).then(pdfBuffer => {
                const fileName = `invoice_${Date.now()}.pdf`;
                fs.writeFileSync(fileName, pdfBuffer);
                
                ctx.replyWithDocument({ source: fileName }).then(() => {
                    const transactionLog = `\n--- Invoice ${new Date().toLocaleDateString('en-GB')} ---\nDesc: ${data.description}, Price: ${formattedPrice}, Paid: ${formattedPaid}, Balance: ${formattedBalance}`;
                    db.run(`UPDATE clients SET transactions = COALESCE(transactions, '') || ? WHERE name = ?`, [transactionLog, data.clientName]);
                    
                    fs.unlinkSync(fileName);
                    ctx.reply("Invoice sent and saved to " + data.clientName + "'s file.");
                }).catch(err => {
                    ctx.reply("Error sending PDF: " + err.message);
                });
                
                delete userStates[chatId];
            }).catch(err => {
                ctx.reply("Error creating PDF: " + err.message);
                delete userStates[chatId];
            });
            return;
        }

        if (state === 'edit_field') {
            const field = text.trim();
            if (field === 'phone' || field === 'measurements' || field === 'notes') {
                userStates[chatId].editField = field;
                userStates[chatId].step = 'edit_value';
                return ctx.reply("What is the new value for " + field + "?");
            } else {
                return ctx.reply("Please reply with 'Phone', 'Measurements', or 'Notes'.");
            }
        }
        if (state === 'edit_value') {
            const clientName = userStates[chatId].targetName;
            const field = userStates[chatId].editField;
            const newValue = ctx.message.text;
            
            db.run(`UPDATE clients SET ${field} = ? WHERE name = ?`, [newValue, clientName], (err) => {
                if (err) {
                    ctx.reply("I had trouble updating that.");
                } else {
                    ctx.reply(clientName + "'s " + field + " has been updated successfully.");
                }
                delete userStates[chatId];
            });
            return;
        }

        if (state === 'confirm_delete') {
            if (text === 'yes' || text === 'y') {
                const clientName = userStates[chatId].targetName;
                db.run(`DELETE FROM clients WHERE name = ?`, [clientName], (err) => {
                    if (err) ctx.reply("I had trouble deleting that.");
                    else ctx.reply(clientName + " has been permanently deleted.");
                    delete userStates[chatId];
                });
            } else {
                ctx.reply("Deletion cancelled.");
                delete userStates[chatId];
            }
            return;
        }
    }

    if (text.includes('find') || text.includes('look up') || text.includes('bring') || text.includes('get') || text.includes('file')) {
        const match = ctx.message.text.match(/(?:find|look up|bring|get|show|file)(?:\s+me)?(?:\s+the)?(?:\s+file)?(?:\s+of)?(?:\s+client)?\s+(.+)/i);
        if (match && match[1]) {
            const cleanName = match[1].replace(/'s/gi, '').replace(/file/gi, '').trim();
            db.get(`SELECT * FROM clients WHERE name LIKE ?`, [`%${cleanName}%`], (err, row) => {
                if (err) ctx.reply("Database error.");
                else if (row) {
                    ctx.reply("Found her. Name: " + row.name + ". Phone: " + row.phone + ". Measurements: " + row.measurements);
                } else {
                    ctx.reply("I couldn't find a client named " + cleanName + ".");
                }
            });
        } else {
            ctx.reply("Who are you looking for?");
        }
    }
    
    else if (text.includes('transactions') || text.includes('history') || text.includes('payments')) {
        const match = ctx.message.text.match(/(?:transactions|history|payments)(?:\s+for)?\s+(.+)/i);
        if (match && match[1]) {
            const cleanName = match[1].trim();
            db.get(`SELECT * FROM clients WHERE name LIKE ?`, [`%${cleanName}%`], (err, row) => {
                if (err) ctx.reply("Database error.");
                else if (row) {
                    ctx.reply("Transaction history for " + row.name + ":\n" + (row.transactions || "None yet."));
                } else {
                    ctx.reply("I couldn't find a client named " + cleanName + ".");
                }
            });
        } else {
            ctx.reply("Who are you looking for? Example: transactions for John");
        }
    }
    
    else if (text.includes('zoila')) {
        const responses = [
            "Yes? I'm here. How can I help you?",
            "At your service. What would you like to do?",
            "Hello! What can I do for you?",
            "Yes, I'm listening. How may I assist you today?"
        ];
        ctx.reply(responses[Math.floor(Math.random() * responses.length)]);
    }
    
    else {
        ctx.reply("I'm not sure what you mean. Say 'guide' to see everything I can do.");
    }
});

bot.launch();
