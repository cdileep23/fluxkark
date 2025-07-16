import express from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(express.json());


interface Contact {
  id: number;
  phoneNumber: string|null;
  email: string | null;
  linkedId: number|null;
  linkPrecedence: "primary" | "secondary";
  createdAt: Date;
  updatedAt: Date;

}

interface IdentifyRequest {
  email?: string;
  phoneNumber?: string;
}

interface IdentifyResponse {
  contact: {
    primaryContatctId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}


async function getAllLinkedContacts(
  primaryContactId: number
): Promise<Contact[]> {
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


async function findPrimaryContactId(contactId: number): Promise<number> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });

  if (!contact) {
    throw new Error("Contact not found");
  }

  return contact.linkPrecedence === "primary" ? contact.id : contact.linkedId!;
}

async function mergeContactChains(
  primaryId1: number,
  primaryId2: number
): Promise<number> {
  
  const primary1 = await prisma.contact.findUnique({
    where: { id: primaryId1 },
  });
  const primary2 = await prisma.contact.findUnique({
    where: { id: primaryId2 },
  });

  if (!primary1 || !primary2) {
    throw new Error("Primary contacts not found");
  }

  const olderPrimary =
    primary1.createdAt <= primary2.createdAt ? primary1 : primary2;
  const newerPrimary =
    primary1.createdAt <= primary2.createdAt ? primary2 : primary1;

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

app.get('/',(req:express.Request,res:express.Response)=>{
    res.send("hello from bitespeed backend assignment")
})
app.post("/identify", async (req: express.Request, res: express.Response) => {
  try {
    const { email, phoneNumber }: IdentifyRequest = req.body;

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


    let primaryContactId: number;
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
    } else {
   
      const primaryIds = new Set<number>();
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
          ? allLinkedContacts.some(
              (c) => c.phoneNumber === phoneNumber.toString()
            )
          : true;

        if (!hasMatchingEmail || !hasMatchingPhone) {
          shouldCreateNewContact = true;
        }
      } else {
       
        const primaryIdArray = Array.from(primaryIds);
        primaryContactId = primaryIdArray[0];

        for (let i = 1; i < primaryIdArray.length; i++) {
          primaryContactId = await mergeContactChains(
            primaryContactId,
            primaryIdArray[i]
          );
        }

        const allLinkedContacts = await getAllLinkedContacts(primaryContactId);
        const hasMatchingEmail = email
          ? allLinkedContacts.some((c) => c.email === email)
          : true;
        const hasMatchingPhone = phoneNumber
          ? allLinkedContacts.some(
              (c) => c.phoneNumber === phoneNumber.toString()
            )
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

 
    const emails: string[] = [];
    const phoneNumbers: string[] = [];
    const secondaryContactIds: number[] = [];

    
    allLinkedContacts.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

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

    const response: IdentifyResponse = {
      contact: {
        primaryContatctId: primaryContactId,
        emails,
        phoneNumbers,
        secondaryContactIds,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in /identify endpoint:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
