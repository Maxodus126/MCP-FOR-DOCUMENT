import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

function headingLevel(hashes: number): (typeof HEADING_LEVELS)[number] {
  return HEADING_LEVELS[Math.min(hashes, HEADING_LEVELS.length) - 1]!;
}

function renderParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      paragraphs.push(new Paragraph({ heading: headingLevel(heading[1]!.length), children: [new TextRun(heading[2]!.trim())] }));
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(bullet[1]!.trim())] }));
      continue;
    }
    paragraphs.push(new Paragraph({ children: [new TextRun(line.trim())] }));
  }
  return paragraphs;
}

export async function buildDocxBuffer(markdown: string): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: renderParagraphs(markdown) }],
  });
  return await Packer.toBuffer(doc);
}
