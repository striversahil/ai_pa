import { PrismaClient } from "@prisma/client";
import { Enquiry, EnquiryComment, EnquiryRequirement, EnquiryStore, parseRequirements } from "./store";

// Prisma-backed EnquiryStore for the Express / Postgres runtime. Kept in a
// separate file so the Prisma client never enters the Cloudflare Worker bundle.

function mapEnquiry(row: any): Enquiry | null {
  if (!row) return null;
  return {
    id: row.id,
    estNumber: row.estNumber ?? "",
    clientCompany: row.clientCompany,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assignedAgentId: String(row.assignedAgentId ?? ""),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    imageUrls: row.imageUrls ? JSON.parse(row.imageUrls) : [],
    activities: row.activities ? JSON.parse(row.activities) : [],
    additionalRequirements: parseRequirements(row.additionalRequirements),
  };
}

function mapComment(row: any): EnquiryComment | null {
  if (!row) return null;
  return {
    id: row.id,
    enquiryId: row.enquiryId,
    agentId: row.agentId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    parentId: row.parentId,
    imageUrl: row.imageUrl ?? undefined,
  };
}

export class PrismaEnquiryStore implements EnquiryStore {
  constructor(private prisma: PrismaClient) {}

  async listEnquiries() {
    const rows = await this.prisma.enquiry.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(mapEnquiry).filter(Boolean) as Enquiry[];
  }
  async getEnquiry(id: string) {
    const row = await this.prisma.enquiry.findUnique({ where: { id } });
    return mapEnquiry(row);
  }
  async createEnquiry(data) {
    const row = await this.prisma.enquiry.create({
      data: {
        ...data,
        imageUrls: JSON.stringify(data.imageUrls ?? []),
        activities: JSON.stringify(data.activities ?? []),
        additionalRequirements: JSON.stringify(data.additionalRequirements ?? []),
      },
    });
    return mapEnquiry(row)!;
  }
  async updateEnquiry(id, updates) {
    const data: any = { ...updates, updatedAt: new Date() };
    if (data.imageUrls) data.imageUrls = JSON.stringify(data.imageUrls);
    if (data.activities) data.activities = JSON.stringify(data.activities);
    if (data.additionalRequirements) data.additionalRequirements = JSON.stringify(data.additionalRequirements);
    const row = await this.prisma.enquiry.update({ where: { id }, data }).catch(() => null);
    return row ? mapEnquiry(row) : null;
  }
  async deleteEnquiry(id) {
    await this.prisma.enquiry.delete({ where: { id } }).catch(() => {});
  }
  async listComments(enquiryId: string) {
    const rows = await this.prisma.enquiryComment.findMany({
      where: { enquiryId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapComment).filter(Boolean) as EnquiryComment[];
  }
  async addComment(data) {
    const row = await this.prisma.enquiryComment.create({ data: { ...data, createdAt: new Date() } });
    return mapComment(row)!;
  }
  async listAllComments() {
    const rows = await this.prisma.enquiryComment.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(mapComment).filter(Boolean) as EnquiryComment[];
  }
}