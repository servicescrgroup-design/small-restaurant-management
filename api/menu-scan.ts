/**
 * POST /api/menu-scan — read photos of a restaurant's printed menu and return its dishes.
 *
 * Runs on Vercel next to the app. The Anthropic API key lives only here (ANTHROPIC_API_KEY in the
 * Vercel project settings), and only signed-in Mise accounts can call it, so nobody else can spend
 * on the key.
 *
 * Body: { images: [{ media_type: "image/jpeg" | "image/png" | "image/webp", data: <base64> }] }
 * Header: Authorization: Bearer <the user's Supabase access token>
 */
import Anthropic from '@anthropic-ai/sdk';

// The app's public project URL and publishable key (public by design, also in .env)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://ilikwspmhqxsaioejuew.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_YhWVDh_txGooPieHYyQeZA_yDW6MEn1';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 3_500_000; // base64 length per image; the client shrinks photos well below this
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const SYSTEM = `You read photos of restaurant menus, usually Thai street-food and rice-shop menus, and list every dish exactly once.

How these menus work:
- Prices are in baht; "50.-" or "50" means 50 baht.
- Many menus have price columns for a choice of meat, such as ไก่ (chicken) / เนื้อ (beef) / ทะเล (seafood), or หมู (pork) / ไก่ / กุ้ง (shrimp). Each column with a price is a variant of that dish. A "-" or blank cell means that choice is not offered, so leave it out.
- A dish with a single price has one variant whose labels are empty strings.
- Lines like "ไข่เจียว 15" or "ไข่ดาว 10" printed outside the dish list, and notes like "พิเศษ +10 บาททุกเมนู" (extra-large +10 baht on every dish), are extras that can be added to any dish: put them in "extras" with the added price.
- Section headings (for example "เมนูอาหารจานเดียว ราดข้าว" or "เมนูกับข้าว") are categories. Use a short, natural category name.
- Ignore opening hours, phone numbers, logos, slogans and photo captions.

For every dish:
- name_th: the Thai name exactly as printed (keep the spelling; drop the dotted leader lines). If the menu is not in Thai, give a natural Thai name.
- name_en: a short, natural English menu name a tourist would understand, e.g. "กะเพรา" → "Stir-fried Holy Basil", "ผัดพริกแกง" → "Red Curry Stir-fry", "ต้มยำกุ้ง" → "Tom Yum Goong (Spicy Shrimp Soup)".
- Variant labels get Thai and English, e.g. ไก่ / Chicken, เนื้อ / Beef, ทะเล / Seafood.

If several photos are given they are parts of the same menu: combine them, and do not repeat a dish that appears twice. If a price is unreadable, give your best reading and add the dish name to "unsure".`;

const variant = {
  type: 'object',
  additionalProperties: false,
  required: ['label_th', 'label_en', 'price'],
  properties: { label_th: { type: 'string' }, label_en: { type: 'string' }, price: { type: 'number' } },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections', 'extras', 'unsure'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category_th', 'category_en', 'dishes'],
        properties: {
          category_th: { type: 'string' },
          category_en: { type: 'string' },
          dishes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name_th', 'name_en', 'variants'],
              properties: { name_th: { type: 'string' }, name_en: { type: 'string' }, variants: { type: 'array', items: variant } },
            },
          },
        },
      },
    },
    extras: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name_th', 'name_en', 'price'],
        properties: { name_th: { type: 'string' }, name_en: { type: 'string' }, price: { type: 'number' } },
      },
    },
    unsure: { type: 'array', items: { type: 'string' } },
  },
} as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Only signed-in Mise accounts may use the scanner. */
async function signedInUser(request: Request): Promise<string | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const user = (await r.json()) as { id?: string };
  return user.id ?? null;
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503);
  if (!(await signedInUser(request))) return json({ error: 'sign_in_required' }, 401);

  let images: { media_type: MediaType; data: string }[];
  try {
    const body = (await request.json()) as { images?: { media_type?: string; data?: string }[] };
    images = (body.images ?? []).map((i) => {
      if (!MEDIA_TYPES.includes(i.media_type as MediaType) || typeof i.data !== 'string' || !i.data || i.data.length > MAX_IMAGE_BYTES) throw new Error('bad image');
      return { media_type: i.media_type as MediaType, data: i.data };
    });
    if (!images.length || images.length > MAX_IMAGES) throw new Error('count');
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const client = new Anthropic();
  try {
    const message = await client.beta.messages
      .stream({
        model: 'claude-opus-5-5',
        max_tokens: 32000,
        // If a safety classifier declines, Anthropic re-runs the request on its recommended fallback model
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            ...images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.media_type, data: img.data } })),
            { type: 'text', text: images.length > 1 ? `These ${images.length} photos are one menu. List every dish.` : 'List every dish on this menu.' },
          ],
        }],
      })
      .finalMessage();

    if (message.stop_reason === 'refusal') return json({ error: 'declined' }, 422);
    if (message.stop_reason === 'max_tokens') return json({ error: 'too_long' }, 422);
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return json(JSON.parse(text));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'busy' }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: 'ai_error', status: e.status }, 502);
    if (e instanceof SyntaxError) return json({ error: 'unreadable' }, 422);
    throw e;
  }
}
