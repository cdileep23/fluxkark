"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
app.use(express_1.default.json());
async function getAllLinkedContacts(primaryContactId) {
    const contacts = await prisma.contact.findMany({
        where: {
            OR: [{ id: primaryContactId }, { linkedId: primaryContactId }],
        },
        orderBy: {
            createdAt: "asc",
        },
    });
    return contacts;
}
async function findPrimaryContactId(contactId) {
    const contact = await prisma.contact.findUnique({
        where: { id: contactId },
    });
    if (!contact) {
        throw new Error("Contact not found");
    }
    return contact.linkPrecedence === "primary" ? contact.id : contact.linkedId;
}
async function mergeContactChains(primaryId1, primaryId2) {
    const primary1 = await prisma.contact.findUnique({
        where: { id: primaryId1 },
    });
    const primary2 = await prisma.contact.findUnique({
        where: { id: primaryId2 },
    });
    if (!primary1 || !primary2) {
        throw new Error("Primary contacts not found");
    }
    const olderPrimary = primary1.createdAt <= primary2.createdAt ? primary1 : primary2;
    const newerPrimary = primary1.createdAt <= primary2.createdAt ? primary2 : primary1;
    await prisma.contact.update({
        where: { id: newerPrimary.id },
        data: {
            linkPrecedence: "secondary",
            linkedId: olderPrimary.id,
            updatedAt: new Date(),
        },
    });
    await prisma.contact.updateMany({
        where: { linkedId: newerPrimary.id },
        data: {
            linkedId: olderPrimary.id,
            updatedAt: new Date(),
        },
    });
    return olderPrimary.id;
}
app.get('/', (req, res) => {
    res.send("hello from bitespeed backend assignment");
});
app.post("/identify", async (req, res) => {
    try {
        const { email, phoneNumber } = req.body;
        if (!email && !phoneNumber) {
            return res
                .status(400)
                .json({ error: "Either email or phoneNumber must be provided" });
        }
        const existingContacts = await prisma.contact.findMany({
            where: {
                OR: [{ email: email }, { phoneNumber: phoneNumber }],
            },
        });
        let primaryContactId;
        let shouldCreateNewContact = false;
        if (existingContacts.length === 0) {
            const newContact = await prisma.contact.create({
                data: {
                    email,
                    phoneNumber: phoneNumber?.toString(),
                    linkPrecedence: "primary",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });
            primaryContactId = newContact.id;
        }
        else {
            const primaryIds = new Set();
            for (const contact of existingContacts) {
                const primaryId = await findPrimaryContactId(contact.id);
                primaryIds.add(primaryId);
            }
            if (primaryIds.size === 1) {
                primaryContactId = Array.from(primaryIds)[0];
                const allLinkedContacts = await getAllLinkedContacts(primaryContactId);
                const hasMatchingEmail = email
                    ? allLinkedContacts.some((c) => c.email === email)
                    : true;
                const hasMatchingPhone = phoneNumber
                    ? allLinkedContacts.some((c) => c.phoneNumber === phoneNumber.toString())
                    : true;
                if (!hasMatchingEmail || !hasMatchingPhone) {
                    shouldCreateNewContact = true;
                }
            }
            else {
                const primaryIdArray = Array.from(primaryIds);
                primaryContactId = primaryIdArray[0];
                for (let i = 1; i < primaryIdArray.length; i++) {
                    primaryContactId = await mergeContactChains(primaryContactId, primaryIdArray[i]);
                }
                const allLinkedContacts = await getAllLinkedContacts(primaryContactId);
                const hasMatchingEmail = email
                    ? allLinkedContacts.some((c) => c.email === email)
                    : true;
                const hasMatchingPhone = phoneNumber
                    ? allLinkedContacts.some((c) => c.phoneNumber === phoneNumber.toString())
                    : true;
                if (!hasMatchingEmail || !hasMatchingPhone) {
                    shouldCreateNewContact = true;
                }
            }
        }
        if (shouldCreateNewContact) {
            await prisma.contact.create({
                data: {
                    email,
                    phoneNumber: phoneNumber?.toString(),
                    linkedId: primaryContactId,
                    linkPrecedence: "secondary",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });
        }
        const allLinkedContacts = await getAllLinkedContacts(primaryContactId);
        const emails = [];
        const phoneNumbers = [];
        const secondaryContactIds = [];
        allLinkedContacts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        for (const contact of allLinkedContacts) {
            if (contact.email && !emails.includes(contact.email)) {
                emails.push(contact.email);
            }
            if (contact.phoneNumber && !phoneNumbers.includes(contact.phoneNumber)) {
                phoneNumbers.push(contact.phoneNumber);
            }
            if (contact.linkPrecedence === "secondary") {
                secondaryContactIds.push(contact.id);
            }
        }
        const response = {
            contact: {
                primaryContatctId: primaryContactId,
                emails,
                phoneNumbers,
                secondaryContactIds,
            },
        };
        res.status(200).json(response);
    }
    catch (error) {
        console.error("Error in /identify endpoint:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map