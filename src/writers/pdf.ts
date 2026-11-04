import PDFDocument from "pdfkit";

export async function buildPdfBuffer(text: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  doc.fontSize(11).text(text);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
