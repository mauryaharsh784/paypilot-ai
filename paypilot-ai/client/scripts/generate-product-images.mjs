// Generates one locally stored, optimized SVG illustration per demo catalog product.
// These are stylised illustrations (not photographs) so they never break and ship with the repo.
// Run: node scripts/generate-product-images.mjs   (reads the product list below, writes public/products/<slug>.svg)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'products');
mkdirSync(out, { recursive: true });

// Brand accent colours (fictional brands)
const brand = {
  Nexa: ['#2F6BFF', '#DCE7FF'], Vanta: ['#E5484D', '#FFE1E2'], Orbit: ['#5B5BF0', '#E6E6FE'],
  Kaito: ['#12A150', '#D8F3E3'], Lumio: ['#F59E0B', '#FFEDCB'],
};
// [category, brand, name, variant]
const items = [
  ['laptops', 'Nexa', 'Nexa Aero 14', 'laptop'], ['laptops', 'Nexa', 'Nexa Aero 15 Lite', 'laptop'],
  ['laptops', 'Vanta', 'Vanta Forge 15', 'gaming'], ['laptops', 'Vanta', 'Vanta Forge 16 Pro', 'gaming'],
  ['laptops', 'Orbit', 'Orbit Slate 13', 'ultrabook'], ['laptops', 'Orbit', 'Orbit Core 14', 'laptop'],
  ['laptops', 'Kaito', 'Kaito Book 15', 'laptop'], ['laptops', 'Kaito', 'Kaito Studio 16', 'gaming'],
  ['phones', 'Lumio', 'Lumio X1', 'phone2'], ['phones', 'Lumio', 'Lumio X1 Pro', 'phone3'],
  ['phones', 'Kaito', 'Kaito Pocket', 'phone1'], ['phones', 'Orbit', 'Orbit One', 'phone3'],
  ['phones', 'Vanta', 'Vanta Pulse', 'phone2'], ['phones', 'Nexa', 'Nexa Edge', 'phone1'],
  ['audio', 'Lumio', 'Lumio Buds', 'buds'], ['audio', 'Lumio', 'Lumio Buds ANC', 'budsanc'],
  ['audio', 'Orbit', 'Orbit Over-Ear', 'overear'], ['audio', 'Kaito', 'Kaito Neckband', 'neckband'],
  ['audio', 'Vanta', 'Vanta Headset', 'headset'],
  ['monitors', 'Nexa', 'Nexa View 24', 'monitor24'], ['monitors', 'Vanta', 'Vanta Arc 27', 'monitorcurve'],
  ['monitors', 'Orbit', 'Orbit Studio 27', 'monitor4k'],
  ['accessories', 'Kaito', 'Kaito Wireless Mouse', 'mouse'], ['accessories', 'Nexa', 'Nexa Mechanical Keyboard', 'keyboard'],
  ['accessories', 'Orbit', 'Orbit USB-C Hub', 'hub'],
];
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const D = '#0C1636', G1 = '#C9D1E3', G2 = '#E7EBF5', SC = '#0F1A3F';

const shapes = {
  laptop: (a) => `<path d="M118 66h164a8 8 0 0 1 8 8v100H110V74a8 8 0 0 1 8-8z" fill="${D}"/><rect x="118" y="74" width="164" height="92" rx="3" fill="${SC}"/><rect x="126" y="82" width="70" height="8" rx="4" fill="${a}"/><rect x="126" y="96" width="120" height="5" rx="2.5" fill="#fff" opacity=".18"/><rect x="126" y="108" width="96" height="5" rx="2.5" fill="#fff" opacity=".12"/><path d="M92 174h216l12 16a6 6 0 0 1-5 9H85a6 6 0 0 1-5-9z" fill="${G1}"/><rect x="170" y="180" width="60" height="6" rx="3" fill="#aab4cc"/>`,
  ultrabook: (a) => `<path d="M126 70h148a7 7 0 0 1 7 7v96H119V77a7 7 0 0 1 7-7z" fill="${a}"/><rect x="124" y="76" width="152" height="90" rx="3" fill="${SC}"/><circle cx="200" cy="120" r="16" fill="${a}" opacity=".9"/><path d="M104 174h192l8 10a4 4 0 0 1-3 7H99a4 4 0 0 1-3-7z" fill="${G1}"/>`,
  gaming: (a) => `<path d="M112 64h176a8 8 0 0 1 8 8v102H104V72a8 8 0 0 1 8-8z" fill="${D}"/><rect x="112" y="72" width="176" height="96" rx="3" fill="${SC}"/><path d="M112 140l60-36 40 24 76-40v72H112z" fill="${a}" opacity=".55"/><rect x="132" y="82" width="60" height="6" rx="3" fill="#fff" opacity=".25"/><path d="M86 176h228l14 18a6 6 0 0 1-5 9H77a6 6 0 0 1-5-9z" fill="#2A3050"/><rect x="120" y="182" width="160" height="5" rx="2.5" fill="${a}"/><rect x="176" y="190" width="48" height="5" rx="2.5" fill="#4b5578"/>`,
  phone1: (a) => phone(a, 1), phone2: (a) => phone(a, 2), phone3: (a) => phone(a, 3),
  buds: (a) => `<ellipse cx="200" cy="168" rx="70" ry="30" fill="${G1}"/><path d="M130 160a70 28 0 0 0 140 0v-8H130z" fill="${G2}"/><g><ellipse cx="170" cy="112" rx="22" ry="26" fill="${a}"/><rect x="176" y="126" width="9" height="42" rx="4.5" fill="${a}"/></g><g><ellipse cx="230" cy="112" rx="22" ry="26" fill="${a}"/><rect x="215" y="126" width="9" height="42" rx="4.5" fill="${a}"/></g><circle cx="170" cy="108" r="6" fill="#fff" opacity=".4"/><circle cx="230" cy="108" r="6" fill="#fff" opacity=".4"/>`,
  budsanc: (a) => shapes.buds(a).replace('rx="70" ry="30" fill="#C9D1E3"', 'rx="76" ry="32" fill="#2A3050"') + `<circle cx="200" cy="164" r="5" fill="${a}"/><path d="M155 84a24 24 0 0 1 30 0M215 84a24 24 0 0 1 30 0" stroke="${a}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>`,
  overear: (a) => `<path d="M118 130V112a82 82 0 0 1 164 0v18" fill="none" stroke="${D}" stroke-width="12" stroke-linecap="round"/><path d="M130 112a70 70 0 0 1 140 0" fill="none" stroke="${a}" stroke-width="5" stroke-linecap="round" opacity=".85"/><rect x="98" y="116" width="42" height="72" rx="20" fill="${D}"/><rect x="260" y="116" width="42" height="72" rx="20" fill="${D}"/><rect x="108" y="128" width="22" height="48" rx="11" fill="${a}"/><rect x="270" y="128" width="22" height="48" rx="11" fill="${a}"/>`,
  neckband: (a) => `<path d="M136 80c-18 40-8 96 64 96s82-56 64-96" fill="none" stroke="${a}" stroke-width="16" stroke-linecap="round"/><circle cx="136" cy="74" r="12" fill="${D}"/><circle cx="264" cy="74" r="12" fill="${D}"/><path d="M136 74c-6-14-8-26-8-40M264 74c6-14 8-26 8-40" stroke="#8a94b0" stroke-width="3" fill="none"/><rect x="120" y="22" width="16" height="16" rx="8" fill="${D}"/><rect x="264" y="22" width="16" height="16" rx="8" fill="${D}"/>`,
  headset: (a) => `<path d="M122 140V112a78 78 0 0 1 156 0v28" fill="none" stroke="${D}" stroke-width="12" stroke-linecap="round"/><rect x="100" y="118" width="40" height="66" rx="18" fill="${D}"/><rect x="260" y="118" width="40" height="66" rx="18" fill="${D}"/><rect x="108" y="130" width="22" height="42" rx="11" fill="${a}"/><path d="M120 184c0 22 20 24 44 24" fill="none" stroke="${D}" stroke-width="6" stroke-linecap="round"/><rect x="162" y="202" width="26" height="12" rx="6" fill="${a}"/>`,
  monitor24: (a) => monitor(a, 'flat', 150),
  monitorcurve: (a) => monitor(a, 'curve', 165),
  monitor4k: (a) => monitor(a, 'flat', 4),
  mouse: (a) => `<path d="M200 56c-32 0-50 22-50 54v34c0 30 20 50 50 50s50-20 50-50v-34c0-32-18-54-50-54z" fill="${G2}" stroke="${G1}" stroke-width="4"/><path d="M200 56c-32 0-50 22-50 54v6h100v-6c0-32-18-54-50-54z" fill="${a}"/><rect x="196" y="76" width="8" height="26" rx="4" fill="#fff"/><path d="M200 56v60" stroke="#fff" stroke-width="2" opacity=".5"/>`,
  keyboard: (a) => { let k = ''; for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) k += `<rect x="${92 + c * 18.2}" y="${96 + r * 22}" width="15" height="17" rx="3.5" fill="${r === 3 && c > 2 && c < 9 ? a : '#fff'}"/>`; return `<path d="M76 84h248a8 8 0 0 1 8 8v92a8 8 0 0 1-8 8H76a8 8 0 0 1-8-8V92a8 8 0 0 1 8-8z" fill="${D}"/>${k}`; },
  hub: (a) => `<rect x="86" y="104" width="228" height="62" rx="16" fill="${G1}"/><rect x="86" y="104" width="228" height="22" rx="11" fill="${G2}"/><rect x="104" y="136" width="30" height="14" rx="3" fill="${D}"/><rect x="142" y="136" width="30" height="14" rx="3" fill="${D}"/><rect x="182" y="134" width="40" height="18" rx="3" fill="${a}"/><rect x="232" y="138" width="24" height="10" rx="2" fill="${D}"/><rect x="264" y="138" width="30" height="10" rx="2" fill="${D}"/><path d="M60 135H86" stroke="${D}" stroke-width="6" stroke-linecap="round"/><rect x="40" y="127" width="22" height="16" rx="4" fill="${D}"/>`,
};
function phone(a, cams) {
  const body = `<rect x="150" y="30" width="100" height="184" rx="18" fill="${D}"/>`;
  if (cams === 3) { // back view with a 3-lens camera island
    return `${body}<rect x="155" y="35" width="90" height="174" rx="14" fill="${a}"/><rect x="155" y="35" width="90" height="174" rx="14" fill="#fff" opacity=".12"/><rect x="166" y="46" width="52" height="58" rx="14" fill="${D}"/><circle cx="182" cy="62" r="9" fill="#0b1228" stroke="#fff" stroke-opacity=".35" stroke-width="2.5"/><circle cx="182" cy="88" r="9" fill="#0b1228" stroke="#fff" stroke-opacity=".35" stroke-width="2.5"/><circle cx="204" cy="75" r="9" fill="#0b1228" stroke="#fff" stroke-opacity=".35" stroke-width="2.5"/><circle cx="208" cy="52" r="3" fill="#fff" opacity=".8"/><rect x="190" y="190" width="20" height="4" rx="2" fill="#fff" opacity=".5"/>`;
  }
  const cut = cams === 2 ? `<circle cx="200" cy="48" r="5" fill="#0b1228"/>` : `<path d="M184 36h32v6a8 8 0 0 1-8 8h-16a8 8 0 0 1-8-8z" fill="${D}"/>`;
  return `${body}<rect x="156" y="36" width="88" height="172" rx="13" fill="${SC}"/><rect x="156" y="36" width="88" height="172" rx="13" fill="${a}" opacity=".28"/><path d="M156 150l88-50v95a13 13 0 0 1-13 13H169a13 13 0 0 1-13-13z" fill="${a}" opacity=".65"/><rect x="172" y="66" width="56" height="7" rx="3.5" fill="#fff" opacity=".7"/><rect x="172" y="80" width="34" height="5" rx="2.5" fill="#fff" opacity=".4"/>${cut}<rect x="190" y="198" width="20" height="3" rx="1.5" fill="#fff" opacity=".6"/>`;
}
function monitor(a, kind, hz) {
  const curve = kind === 'curve';
  const screen = curve
    ? `<path d="M70 52q130 -14 260 0v120q-130 14 -260 0z" fill="${D}"/><path d="M78 60q122 -12 244 0v104q-122 12 -244 0z" fill="${SC}"/><path d="M78 140q60 -50 120 -24t124 -44v92q-122 12 -244 0z" fill="${a}" opacity=".55"/>`
    : `<rect x="70" y="48" width="260" height="126" rx="8" fill="${D}"/><rect x="78" y="56" width="244" height="110" rx="3" fill="${SC}"/><path d="M78 140l70-44 56 30 70-44 48 20v64H78z" fill="${a}" opacity="${hz === 4 ? .8 : .5}"/>${hz === 4 ? `<rect x="92" y="66" width="44" height="7" rx="3.5" fill="#fff" opacity=".7"/><rect x="92" y="80" width="26" height="5" rx="2.5" fill="#fff" opacity=".4"/>` : ''}`;
  return `${screen}<rect x="188" y="176" width="24" height="22" fill="#8a94b0"/><rect x="148" y="196" width="104" height="9" rx="4.5" fill="${G1}"/>${hz === 4 ? `<circle cx="318" cy="168" r="3" fill="${a}"/>` : ''}`;
}

for (const [cat, b, name, v] of items) {
  const [a, tint] = brand[b];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" role="img" aria-label="${name} illustration (demo product)"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7F9FE"/><stop offset="1" stop-color="${tint}"/></linearGradient></defs><rect width="400" height="260" fill="url(#bg)"/><circle cx="330" cy="40" r="70" fill="${a}" opacity=".08"/><ellipse cx="200" cy="228" rx="110" ry="9" fill="#0C1636" opacity=".10"/>${shapes[v](a)}</svg>`;
  writeFileSync(join(out, `${slug(name)}.svg`), svg);
}
// Category fallbacks (used for products with no dedicated image, e.g. ones added by an admin)
const cats = { laptops: 'laptop', phones: 'phone2', audio: 'overear', monitors: 'monitor24', accessories: 'mouse' };
for (const [cat, v] of Object.entries(cats)) {
  writeFileSync(join(out, `_${cat}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" role="img" aria-label="${cat} placeholder"><rect width="400" height="260" fill="#ECECFE"/><ellipse cx="200" cy="228" rx="110" ry="9" fill="#0C1636" opacity=".10"/>${shapes[v]('#5B5BF0')}</svg>`);
}
console.log(`Wrote ${items.length} product images + ${Object.keys(cats).length} category fallbacks to ${out}`);
