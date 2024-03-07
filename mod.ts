import * as csstree from "npm:css-tree@2.3.1";
import { encodeBase64 } from "https://deno.land/std@0.218.2/encoding/base64.ts";
import { Buffer } from "node:buffer";
import { Hono } from "https://deno.land/x/hono@v4.0.10/mod.ts";
import { XmlEntities } from "https://deno.land/x/html_entities@v1.0/mod.js";
import subsetFont from "npm:subset-font@2.1.0";

async function fetchStylesheetFromGoogleFonts(
  family: string,
  weight: string,
): Promise<string> {
  const url =
    `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`;
  const response = await fetch(url);
  return await response.text();
}

async function fetchRemoteFont(url: string, text: string): Promise<[string, string]> {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const p = /(woff2|woff|ttf|otf)$/;
  const m = p.exec(url);
  const subbuffer = await subsetFont(buffer, text, {
    targetFormat: {
      tff: "sfnt",
      otf: "sfnt",
      woff2: "woff2",
      woff: "woff"
    }[m![0]]
  })
  const data = encodeBase64(subbuffer);
  return [url, `data:font/${m![0]};base64,${data}`];
}

async function fetchAllRemoteFonts(
  tree: csstree.CssNode,
  text: string,
): Promise<Map<string, string>> {
  const entries: Promise<[string, string]>[] = [];
  csstree.walk(tree, {
    visit: "Url",
    enter: (node: csstree.Url) =>
      entries.push(fetchRemoteFont(node.value, text)),
  });
  return new Map(await Promise.all(entries));
}

async function generateStylesheet(
  family: string,
  weight: string,
  text: string,
): Promise<string> {
  const stylesheet = await fetchStylesheetFromGoogleFonts(family, weight);
  const tree = csstree.parse(stylesheet);
  const urlToDataurl = await fetchAllRemoteFonts(tree, text);
  csstree.walk(tree, {
    visit: "Url",
    enter: (node) =>
      node.value = urlToDataurl.get(node.value) || "",
  });
  return csstree.generate(tree);
}

async function render(params: URLSearchParams): Promise<string> {
  const size = XmlEntities.encode(params.get("size") || "20");
  const text = XmlEntities.encode(params.get("text") || "");
  const height = XmlEntities.encode(
    params.get("height") || (parseInt(size) * 1.3).toString(),
  );
  const width = XmlEntities.encode(
    params.get("width") || (parseInt(size) * 0.65 * text.length).toString(),
  );
  const color = XmlEntities.encode(params.get("color") || "#000000");
  const family = XmlEntities.encode(params.get("family") || "Abel");
  const weight = XmlEntities.encode(params.get("weight") || "400");
  const stylesheet = await generateStylesheet(family, weight, text);
  return `<svg xmlns="http://www.w3.org/2000/svg" height="${height}" width="${width}">
    <style><![CDATA[${stylesheet}]]></style>
    <text
      fill="${color}"
      x="50%"
      y="50%"
      text-anchor="middle"
      dominant-baseline="central"
      font-size="${size}"
      font-family="${family}">
      ${text}
    </text>
  </svg>`;
}

const app = new Hono();

app.get("/render", async (c) => {
  const body = await render(new URL(c.req.url).searchParams);
  c.header("Content-Type", "image/svg+xml");
  return c.body(body);
});

app.get("/", async (c) => {
  return c.html(await Deno.readTextFile("./index.html"));
});

Deno.serve(app.fetch);
