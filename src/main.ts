import "./style.css";
import { decodeBytes, parseCsv, type Delimiter, type ParsedCsv } from "./csv";
import { toHtml, toJson } from "./export";
import { profileTable, type TableProfile } from "./profile";
import { computeReport, RULE_LABELS, type Report } from "./report";
import type { RuleKind } from "./rules";
import { buildConfig, initialSettings, localIsoDate, type ColumnSetting, type RuleChoice } from "./settings";

const MAX_BYTES = 50 * 1024 * 1024;
const DELIMITER_LABELS: Record<Delimiter, string> = { ",": "przecinek ( , )", ";": "średnik ( ; )", "\t": "tabulator", "|": "kreska pionowa ( | )" };

type Child = Node | string | null | undefined | false;

/** Build DOM without innerHTML: names and values from the user's file are only ever set as text. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key in el) Reflect.set(el, key, value);
    else el.setAttribute(key, String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

interface Loaded {
  fileName: string;
  text: string;
  encoding: string;
  csv: ParsedCsv;
  profile: TableProfile;
  settings: ColumnSetting[];
}

let loaded: Loaded | null = null;
let readers: (() => void)[] = [];
let lastReport: Report | null = null;

const status = h("p", { role: "status", "aria-live": "polite", className: "hint" });
const fileInput = h("input", { id: "file", type: "file", accept: ".csv,.txt,text/csv", onchange: () => void onFile() });
const configSection = h("section", { hidden: true, "aria-labelledby": "config-title" });
const resultSection = h("section", { hidden: true, "aria-labelledby": "result-title" });

function setStatus(message: string): void {
  status.textContent = message;
}

async function onFile(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;
  resultSection.hidden = true;
  if (file.size > MAX_BYTES) {
    loaded = null;
    configSection.hidden = true;
    setStatus(`Plik ma ${(file.size / 1024 / 1024).toFixed(1)} MB. Limit to ${MAX_BYTES / 1024 / 1024} MB. Zmniejsz plik lub wczytaj jego fragment.`);
    return;
  }
  setStatus("Wczytuję plik…");
  try {
    const bytes = await file.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the status message paint before the heavy work
    const { text, encoding } = decodeBytes(bytes);
    load(file.name, text, encoding);
  } catch (error) {
    loaded = null;
    configSection.hidden = true;
    setStatus(`Nie udało się wczytać pliku: ${error instanceof Error ? error.message : "nieznany błąd"}.`);
  }
}

function load(fileName: string, text: string, encoding: string, delimiter?: Delimiter): void {
  const csv = parseCsv(text, delimiter);
  if (csv.headers.length === 0 || csv.rows.length === 0) {
    loaded = null;
    configSection.hidden = true;
    setStatus("W pliku nie znaleziono nagłówka i danych. Sprawdź, czy to plik CSV i czy wybrano właściwy separator.");
    return;
  }
  loaded = { fileName, text, encoding, csv, profile: profileTable(csv), settings: initialSettings(csv, localIsoDate()) };
  resultSection.hidden = true;
  setStatus(`Wczytano ${csv.rows.length} wierszy i ${csv.headers.length} kolumn.`);
  renderConfig();
}

function renderConfig(): void {
  if (!loaded) return;
  const { csv, profile, settings, fileName, encoding } = loaded;
  readers = [];
  configSection.replaceChildren(
    h("h2", { id: "config-title" }, "2. Ustaw, co mierzyć"),
    h(
      "p",
      { className: "hint" },
      `Plik: ${fileName}. Kodowanie: ${encoding}. Wiersze: ${csv.rows.length}. Kolumny: ${csv.headers.length}. Identyczne wiersze: ${profile.duplicateRows}.`,
    ),
    delimiterPicker(),
    h("p", { className: "hint" }, "Podpowiedzi reguł pochodzą z nazwy kolumny lub z zawartości. Zawsze możesz je zmienić."),
    h("div", { className: "scroll", tabIndex: 0, role: "region", "aria-label": "Ustawienia kolumn" }, configTable(settings, profile, csv.headers)),
    h("div", { className: "actions" }, h("button", { type: "button", onclick: () => compute() }, "Policz raport")),
  );
  configSection.hidden = false;
}

function delimiterPicker(): HTMLElement {
  if (!loaded) return h("span");
  const current = loaded.csv.delimiter;
  const select = h("select", { id: "delimiter" });
  for (const d of Object.keys(DELIMITER_LABELS) as Delimiter[]) select.append(h("option", { value: d, selected: d === current }, DELIMITER_LABELS[d]));
  select.addEventListener("change", () => {
    if (loaded) load(loaded.fileName, loaded.text, loaded.encoding, select.value as Delimiter);
  });
  return h("p", {}, h("label", { htmlFor: "delimiter" }, "Separator: "), select);
}

function configTable(settings: ColumnSetting[], profile: TableProfile, headers: string[]): HTMLElement {
  const head = h(
    "tr",
    {},
    ...["Kolumna", "Typ i braki", "Wymagane", "Tylko gdy…", "Reguła ważności", "Część klucza"].map((t) => h("th", { scope: "col" }, t)),
  );
  const body = h("tbody");
  settings.forEach((s, i) => {
    const p = profile.columns[i]!;
    const id = `col-${i}`;

    const required = h("input", { id: `${id}-req`, type: "checkbox", checked: s.required });
    const condColumn = h("select", { id: `${id}-cc`, "aria-label": `Warunek dla ${s.column}: kolumna` });
    condColumn.append(h("option", { value: "" }, "zawsze"));
    for (const other of headers) if (other !== s.column) condColumn.append(h("option", { value: other }, `gdy ${other} =`));
    const condValue = h("input", { id: `${id}-cv`, type: "text", placeholder: "wartość", size: 10, "aria-label": `Warunek dla ${s.column}: wartość` });

    const rule = h("select", { id: `${id}-rule`, "aria-label": `Reguła ważności dla ${s.column}` });
    rule.append(h("option", { value: "none" }, "brak"));
    for (const kind of Object.keys(RULE_LABELS) as RuleKind[]) rule.append(h("option", { value: kind, selected: s.rule === kind }, RULE_LABELS[kind]));
    const min = h("input", { id: `${id}-min`, type: "number", placeholder: "min", "aria-label": `Minimum dla ${s.column}` });
    const max = h("input", { id: `${id}-max`, type: "number", placeholder: "max", "aria-label": `Maksimum dla ${s.column}` });
    const range = h("div", { className: "range", hidden: s.rule !== "number_range" }, min, " ", max);
    rule.addEventListener("change", () => (range.hidden = rule.value !== "number_range"));
    const hint = s.suggestedFrom ? h("div", { className: "hint" }, s.suggestedFrom === "name" ? "podpowiedź z nazwy" : "podpowiedź z treści") : null;

    const key = h("input", { id: `${id}-key`, type: "checkbox", checked: s.key, "aria-label": `${s.column} jest częścią klucza` });

    readers.push(() => {
      s.required = required.checked;
      s.condition = condColumn.value ? { column: condColumn.value, equals: condValue.value } : undefined;
      s.rule = rule.value as RuleChoice;
      s.min = min.value === "" ? undefined : Number(min.value);
      s.max = max.value === "" ? undefined : Number(max.value);
      s.key = key.checked;
    });

    body.append(
      h(
        "tr",
        {},
        h("th", { scope: "row" }, s.column),
        h("td", {}, `${p.type}, braki: ${p.missing} (${(100 - p.completenessPct).toFixed(1)}%)`),
        h("td", {}, h("label", { htmlFor: `${id}-req` }, required, " tak")),
        h("td", {}, h("div", { className: "cond" }, condColumn, condValue)),
        h("td", {}, rule, hint, range),
        h("td", {}, key),
      ),
    );
  });
  return h("table", { className: "config" }, h("caption", { className: "hint" }, "Ustawienia kolumn"), h("thead", {}, head), body);
}

function compute(): void {
  if (!loaded) return;
  readers.forEach((read) => read());
  lastReport = computeReport(loaded.csv, buildConfig(loaded.settings, localIsoDate()));
  renderResult();
  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResult(): void {
  if (!lastReport || !loaded) return;
  const report = lastReport;
  const baseName = loaded.fileName.replace(/\.[^.]+$/, "") || "dane";
  const examples = h("input", { id: "examples", type: "checkbox", checked: true });
  const frame = h("iframe", {
    className: "report",
    title: "Raport jakości danych",
    // No scripts, no same-origin: the report is inert markup. Popups are allowed only so the audit link can open.
    sandbox: "allow-popups allow-popups-to-escape-sandbox",
  });
  const refresh = () => (frame.srcdoc = toHtml(report, { includeExamples: examples.checked }));
  examples.addEventListener("change", refresh);
  refresh();

  resultSection.replaceChildren(
    h("h2", { id: "result-title" }, "3. Raport"),
    h(
      "div",
      { className: "actions" },
      h("button", { type: "button", onclick: () => download(`${baseName}-raport.html`, toHtml(report, { includeExamples: examples.checked }), "text/html") }, "Pobierz raport HTML"),
      h("button", { type: "button", className: "secondary", onclick: () => download(`${baseName}-raport.json`, toJson(report), "application/json") }, "Pobierz JSON"),
      h("label", { htmlFor: "examples" }, examples, " Dołącz przykłady błędnych wartości (odznacz przed udostępnieniem)"),
    ),
    frame,
  );
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const link = h("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.replaceChildren(
    h("h1", {}, "DQ Profiler"),
    h("p", { className: "lead" }, "Wgraj plik CSV i zobacz jego jakość: kompletność, unikalność i ważność, z semaforem 95% / 85%."),
    h(
      "p",
      { className: "notice" },
      "Plik jest przetwarzany wyłącznie w tej przeglądarce. Nie jest wysyłany na żaden serwer, a przeglądarka blokuje wszelkie połączenia sieciowe z tej strony. Limit: 50 MB, UTF-8 lub Windows-1250.",
    ),
    h("section", { "aria-labelledby": "load-title" }, h("h2", { id: "load-title" }, "1. Wybierz plik"), h("label", { htmlFor: "file" }, "Plik CSV"), fileInput, status),
    configSection,
    resultSection,
  );
}
