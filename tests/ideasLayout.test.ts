import { describe, expect, it } from "vitest";
import {
  analyseIdeas,
  boxGap,
  cleanPageText,
  cleanText,
  ideaAsset,
  ideaAssetId,
  ideaImageBase,
  ideaTextFile,
  readingOrder,
  slug,
  type Box,
  type ExtractedPage,
  type TextLine,
} from "../src/assets/ideasLayout.ts";
import { assetSchema } from "../src/assets/manifest.ts";

const line = (text: string, bbox: Box, size = 11, block = 0): TextLine => ({ text, bbox, size, block });

// Shaped after a Google Docs export: a title page, a page of captioned images without a heading,
// a section with a short label above four images, and a heading beside the top of an image.
const pages: ExtractedPage[] = [
  {
    page: 1,
    lines: [
      line("Medusa Tattoo ", [72, 73, 250, 102], 26, 0),
      line("●\u200b Calm or evil, not too sexy. ", [90, 110, 300, 122], 11, 1),
      line("●\u200b Shouldn’t look like stone. ", [90, 124, 539, 137], 11, 1),
      line(" ", [72, 170, 75, 182], 11, 1),
      line("This is the closest I’ve found: ", [72, 197, 326, 209], 11, 1),
    ],
    images: [{ bbox: [156, 227, 456, 701] }],
  },
  {
    page: 2,
    lines: [
      line("Too sexy, but details are amazing ", [288, 87, 521, 99], 11, 0),
      line(" ", [72, 300, 75, 312], 11, 0),
      line("Too comic, but the motive is interesting ", [72, 421, 264, 434], 11, 0),
      line("Snakes look good ", [324, 451, 529, 463], 11, 0),
    ],
    // Drawing order differs from reading order.
    images: [
      { bbox: [292, 108, 558, 424] },
      { bbox: [62, 115, 272, 398] },
      { bbox: [76, 457, 246, 748] },
      { bbox: [308, 484, 530, 764] },
    ],
  },
  {
    page: 3,
    lines: [
      line("Additional Elements ", [72, 73, 254, 95], 20, 0),
      line("Charon ", [72, 105, 111, 117], 11, 1),
    ],
    images: [{ bbox: [74, 121, 234, 402] }, { bbox: [237, 120, 425, 402] }, { bbox: [74, 430, 227, 698] }],
  },
  {
    page: 4,
    lines: [line(" Skull ", [72, 119, 126, 141], 20, 0)],
    images: [{ bbox: [362, 129, 492, 434] }, { bbox: [74, 160, 312, 518] }],
  },
  { page: 5, lines: [], images: [{ bbox: [74, 74, 411, 544] }] },
];

describe("text helpers", () => {
  it("cleans bullets, zero-width characters and whitespace", () => {
    expect(cleanText("●\u200b Calm  or evil \n")).toBe("Calm or evil");
    expect(cleanText("\u200b")).toBe("");
  });

  it("cleans page text and drops empty pages", () => {
    expect(cleanPageText("Title \n\n\n\n\u200bText  \n \n")).toBe("Title\n\nText\n");
    expect(cleanPageText(" \n\u200b\n")).toBeNull();
  });

  it("names files and ids with two-digit numbers", () => {
    expect(ideaImageBase(3, 1)).toBe("page-03-img-01");
    expect(ideaTextFile(12)).toBe("ideas/page-12.txt");
    expect(ideaAssetId(3, 1)).toBe("ideas-p03-01");
  });

  it("slugs headings into tags", () => {
    expect(slug("Mouggri - Tattoos I like")).toBe("mouggri-tattoos-i-like");
    expect(slug(" Mäander! ")).toBe("maander");
  });
});

describe("geometry", () => {
  it("measures gaps between boxes", () => {
    expect(boxGap([0, 0, 10, 10], [5, 5, 20, 20])).toBe(0);
    expect(boxGap([0, 0, 10, 10], [13, 14, 20, 20])).toBe(5);
  });

  it("orders images in rows, left to right", () => {
    expect(readingOrder(pages[1]!.images.map((i) => i.bbox))).toEqual([1, 0, 2, 3]);
    expect(readingOrder([])).toEqual([]);
  });
});

describe("analyseIdeas", () => {
  const result = analyseIdeas(pages);
  const get = (page: number, n: number) => result.find((r) => r.page === page && r.number === n)!;

  it("returns every image once, numbered per page", () => {
    expect(result).toHaveLength(11);
    expect(result.map((r) => ideaAssetId(r.page, r.number))).toEqual([
      "ideas-p01-01",
      "ideas-p02-01",
      "ideas-p02-02",
      "ideas-p02-03",
      "ideas-p02-04",
      "ideas-p03-01",
      "ideas-p03-02",
      "ideas-p03-03",
      "ideas-p04-01",
      "ideas-p04-02",
      "ideas-p05-01",
    ]);
    expect(get(2, 1).imageIndex).toBe(1);
  });

  it("assigns the caption next to an image, not the text block further away", () => {
    expect(get(1, 1).captions).toEqual(["This is the closest I’ve found:"]);
    expect(get(2, 1).captions).toEqual([]);
    expect(get(2, 2).captions).toEqual(["Too sexy, but details are amazing"]);
    // Equally far from the image above and the image below: captions above images win.
    expect(get(2, 3).captions).toEqual(["Too comic, but the motive is interesting"]);
    expect(get(2, 4).captions).toEqual(["Snakes look good"]);
  });

  it("tracks headings across pages and short labels within a page", () => {
    expect(get(1, 1).heading).toEqual({ text: "Medusa Tattoo", page: 1 });
    expect(get(2, 2).heading).toEqual({ text: "Medusa Tattoo", page: 1 });
    for (const n of [1, 2, 3]) {
      expect(get(3, n).heading?.text).toBe("Additional Elements");
      expect(get(3, n).label).toBe("Charon");
      expect(get(3, n).captions).toEqual([]);
    }
    // The image beside the heading starts below the heading's top edge.
    expect(get(4, 1).heading?.text).toBe("Skull");
    expect(get(4, 2).label).toBeUndefined();
    expect(get(5, 1).heading).toEqual({ text: "Skull", page: 4 });
  });

  it("respects the caption distance limit", () => {
    const far = analyseIdeas(pages, { maxCaptionGap: 5 });
    expect(far.find((r) => r.page === 1)!.captions).toEqual([]);
  });
});

describe("ideaAsset", () => {
  const result = analyseIdeas(pages);

  it("builds a valid manifest entry with source, notes and tags", () => {
    const asset = ideaAsset(result[0]!, "ideas/page-01-img-01.jpg");
    expect(assetSchema.parse(asset)).toEqual(asset);
    expect(asset).toMatchObject({
      id: "ideas-p01-01",
      kind: "idea",
      source: 'ideas.pdf p.1, under "Medusa Tattoo"',
      notes: "This is the closest I’ve found:",
      tags: ["medusa-tattoo"],
      page: 1,
      bbox: [156, 227, 456, 701],
    });
  });

  it("marks headings from earlier pages as such and does not tag them", () => {
    const asset = ideaAsset(
      result.find((r) => r.page === 2)!,
      "ideas/page-02-img-01.png",
    );
    expect(asset.source).toBe('ideas.pdf p.2, after heading "Medusa Tattoo" on p.1');
    expect(asset.tags).toEqual([]);
    expect(asset.notes).toBeUndefined();
  });

  it("adds the label to source and tags", () => {
    const asset = ideaAsset(
      result.find((r) => r.page === 3)!,
      "ideas/page-03-img-01.png",
    );
    expect(asset.source).toBe('ideas.pdf p.3, under "Additional Elements" > "Charon"');
    expect(asset.tags).toEqual(["additional-elements", "charon"]);
  });

  it("works for a PDF without any text", () => {
    const [img] = analyseIdeas([{ page: 1, lines: [], images: [{ bbox: [0.04, 1, 2, 3] }] }]);
    expect(ideaAsset(img!, "ideas/page-01-img-01.png")).toMatchObject({
      source: "ideas.pdf p.1",
      tags: [],
      bbox: [0, 1, 2, 3],
    });
  });
});
