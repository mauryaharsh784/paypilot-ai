import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from './config';
import { PricePoint, Product, User } from './models';

// Sample catalog with fictional brands. Prices are in INR. Replace via the admin dashboard or your own import.
type S = Record<string, string | number>;
const P = (category: string, brand: string, name: string, price: number, mrp: number, rating: number, reviews: number, stock: number, tags: string[], specs: S, description: string) =>
  ({ category, brand, name, price, mrp, rating, reviews, stock, tags, specs, description });

const catalog = [
  P('laptops', 'Nexa', 'Nexa Aero 14', 42990, 49990, 4.4, 1820, 14, ['programming', 'multitasking', 'student', 'portable', 'work', 'battery'], { cpu: '6-core, 4.2 GHz', ram_gb: 16, storage_gb: 512, gpu: 'Integrated', display_in: 14, weight_kg: 1.4, battery_hours: 9, perf: 62, os: 'Windows' }, 'A balanced 14-inch laptop with 16 GB RAM that stays quiet under compile loads.'),
  P('laptops', 'Nexa', 'Nexa Aero 15 Lite', 36490, 41990, 4.1, 960, 20, ['student', 'work', 'budget', 'programming'], { cpu: '6-core, 3.9 GHz', ram_gb: 8, storage_gb: 512, gpu: 'Integrated', display_in: 15.6, weight_kg: 1.7, battery_hours: 7, perf: 48 }, 'An affordable everyday laptop. RAM is the limit for heavy multitasking.'),
  P('laptops', 'Vanta', 'Vanta Forge 15', 49490, 58990, 4.3, 2410, 9, ['gaming', 'programming', 'multitasking', 'creative'], { cpu: '8-core, 4.4 GHz', ram_gb: 16, storage_gb: 512, gpu: 'Entry discrete, 4 GB', display_in: 15.6, refresh_hz: 144, weight_kg: 2.2, battery_hours: 5, perf: 74 }, 'A 144 Hz gaming laptop with a discrete GPU that also handles development work.'),
  P('laptops', 'Vanta', 'Vanta Forge 16 Pro', 74990, 84990, 4.6, 1130, 6, ['gaming', 'creative', 'multitasking', 'programming', 'premium'], { cpu: '8-core, 4.8 GHz', ram_gb: 32, storage_gb: 1024, gpu: 'Mid discrete, 8 GB', display_in: 16, refresh_hz: 165, weight_kg: 2.4, battery_hours: 6, perf: 88 }, 'High-end performance with 32 GB RAM for gaming and creative workloads.'),
  P('laptops', 'Orbit', 'Orbit Slate 13', 58990, 64990, 4.7, 740, 5, ['portable', 'travel', 'battery', 'work', 'programming', 'premium', 'multitasking'], { cpu: '8-core efficiency, 4.0 GHz', ram_gb: 16, storage_gb: 512, gpu: 'Integrated', display_in: 13.3, weight_kg: 1.1, battery_hours: 14, perf: 66 }, 'A 1.1 kg ultrabook with all-day battery life.'),
  P('laptops', 'Orbit', 'Orbit Core 14', 47990, 52990, 4.4, 1390, 11, ['programming', 'multitasking', 'work', 'student'], { cpu: '8-core, 4.1 GHz', ram_gb: 16, storage_gb: 1024, gpu: 'Integrated', display_in: 14, weight_kg: 1.5, battery_hours: 10, perf: 64 }, 'Roomy 1 TB storage and 16 GB RAM in a sturdy 14-inch body.'),
  P('laptops', 'Kaito', 'Kaito Book 15', 29990, 34990, 3.9, 2210, 30, ['budget', 'student', 'work'], { cpu: '4-core, 3.6 GHz', ram_gb: 8, storage_gb: 512, gpu: 'Integrated', display_in: 15.6, weight_kg: 1.8, battery_hours: 6, perf: 40 }, 'A no-frills laptop for browsing, documents and classes.'),
  P('laptops', 'Kaito', 'Kaito Studio 16', 64990, 72990, 4.5, 610, 7, ['creative', 'programming', 'multitasking', 'gaming'], { cpu: '8-core, 4.5 GHz', ram_gb: 32, storage_gb: 1024, gpu: 'Entry discrete, 6 GB', display_in: 16, refresh_hz: 120, weight_kg: 2.0, battery_hours: 7, perf: 80 }, 'A 16-inch creator laptop with 32 GB RAM and a colour-accurate panel.'),

  P('phones', 'Lumio', 'Lumio X1', 24999, 27999, 4.3, 5400, 40, ['camera', 'battery', 'budget'], { ram_gb: 8, storage_gb: 128, camera_mp: 64, battery_mah: 5000, display_in: 6.6, refresh_hz: 120, perf: 52 }, 'A well-rounded phone with a 64 MP main camera and two-day battery.'),
  P('phones', 'Lumio', 'Lumio X1 Pro', 34999, 39999, 4.5, 3100, 25, ['camera', 'battery', 'premium', 'creative'], { ram_gb: 12, storage_gb: 256, camera_mp: 108, battery_mah: 5000, display_in: 6.7, refresh_hz: 120, perf: 66 }, 'Upgraded camera system and 256 GB storage.'),
  P('phones', 'Kaito', 'Kaito Pocket', 14499, 16999, 4.0, 8200, 60, ['budget', 'battery', 'student'], { ram_gb: 6, storage_gb: 128, camera_mp: 50, battery_mah: 5000, display_in: 6.5, refresh_hz: 90, perf: 38 }, 'A dependable budget phone with a large battery.'),
  P('phones', 'Orbit', 'Orbit One', 49999, 54999, 4.7, 1900, 12, ['camera', 'premium', 'creative', 'battery'], { ram_gb: 12, storage_gb: 256, camera_mp: 50, battery_mah: 4600, display_in: 6.3, refresh_hz: 120, perf: 82 }, 'A flagship with a fast chip and a consistent camera.'),
  P('phones', 'Vanta', 'Vanta Pulse', 29999, 33999, 4.4, 2600, 18, ['gaming', 'battery', 'multitasking'], { ram_gb: 12, storage_gb: 256, camera_mp: 50, battery_mah: 5500, display_in: 6.7, refresh_hz: 144, perf: 72 }, 'A gaming phone with a 144 Hz screen and an oversized battery.'),
  P('phones', 'Nexa', 'Nexa Edge', 19999, 22999, 4.2, 4300, 35, ['camera', 'budget', 'student'], { ram_gb: 8, storage_gb: 128, camera_mp: 50, battery_mah: 4800, display_in: 6.4, refresh_hz: 90, perf: 46 }, 'A clean-software phone with a reliable everyday camera.'),

  P('audio', 'Lumio', 'Lumio Buds', 2499, 3499, 4.0, 9800, 80, ['wireless', 'budget', 'calls', 'audio'], { battery_hours: 24, connectivity: 'Bluetooth 5.3', anc: 'No', weight_kg: 0.05 }, 'Comfortable true-wireless earbuds with clear call quality.'),
  P('audio', 'Lumio', 'Lumio Buds ANC', 5999, 7999, 4.3, 4100, 45, ['wireless', 'noise-cancelling', 'calls', 'audio', 'travel'], { battery_hours: 30, connectivity: 'Bluetooth 5.3', anc: 'Yes', weight_kg: 0.05 }, 'Active noise cancelling earbuds with a transparency mode.'),
  P('audio', 'Orbit', 'Orbit Over-Ear', 11999, 14999, 4.6, 1500, 15, ['wireless', 'noise-cancelling', 'audio', 'premium', 'travel', 'work'], { battery_hours: 40, connectivity: 'Bluetooth 5.3, 3.5 mm', anc: 'Yes', weight_kg: 0.26 }, 'Over-ear headphones with strong ANC and 40-hour battery.'),
  P('audio', 'Kaito', 'Kaito Neckband', 1299, 1799, 3.9, 12100, 100, ['wireless', 'budget', 'fitness', 'audio'], { battery_hours: 30, connectivity: 'Bluetooth 5.2', anc: 'No', weight_kg: 0.04 }, 'A sweat-resistant neckband for workouts and commutes.'),
  P('audio', 'Vanta', 'Vanta Headset', 3999, 5499, 4.2, 3300, 28, ['gaming', 'calls', 'audio', 'work'], { battery_hours: 0, connectivity: 'USB / 3.5 mm', anc: 'No', weight_kg: 0.32 }, 'A wired gaming headset with a detachable microphone.'),

  P('monitors', 'Nexa', 'Nexa View 24', 10499, 12999, 4.2, 2700, 22, ['work', 'student', 'budget'], { display_in: 24, resolution: '1920x1080', refresh_hz: 75, connectivity: 'HDMI, VGA', perf: 40 }, 'A 24-inch Full HD IPS monitor for office and study.'),
  P('monitors', 'Vanta', 'Vanta Arc 27', 22999, 27999, 4.5, 1250, 10, ['gaming', 'multitasking'], { display_in: 27, resolution: '2560x1440', refresh_hz: 165, connectivity: 'HDMI, DisplayPort', perf: 70 }, 'A 27-inch 1440p monitor with a 165 Hz refresh rate.'),
  P('monitors', 'Orbit', 'Orbit Studio 27', 29999, 34999, 4.6, 540, 6, ['creative', 'work', 'premium'], { display_in: 27, resolution: '3840x2160', refresh_hz: 60, connectivity: 'HDMI, USB-C 65 W', perf: 68 }, 'A 4K monitor with USB-C charging for creative work.'),

  P('accessories', 'Kaito', 'Kaito Wireless Mouse', 799, 1199, 4.1, 15600, 150, ['wireless', 'budget', 'work', 'student'], { connectivity: 'Bluetooth + 2.4 GHz', weight_kg: 0.09, battery_hours: 600 }, 'A quiet-click wireless mouse for daily work.'),
  P('accessories', 'Nexa', 'Nexa Mechanical Keyboard', 3499, 4499, 4.4, 2800, 40, ['programming', 'work', 'gaming'], { connectivity: 'USB-C + Bluetooth', weight_kg: 0.85 }, 'A compact mechanical keyboard with hot-swappable switches.'),
  P('accessories', 'Orbit', 'Orbit USB-C Hub', 1999, 2599, 4.3, 3900, 70, ['portable', 'work', 'travel', 'programming'], { connectivity: 'HDMI, 2x USB-A, SD, USB-C PD 100 W', weight_kg: 0.08 }, 'A 7-in-1 hub that turns one USB-C port into a desk setup.'),
];

(async () => {
  await mongoose.connect(config.mongoUri);
  let created = 0;
  for (const c of catalog) {
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (await Product.exists({ slug })) continue;
    const p = await Product.create({ ...c, slug });
    await PricePoint.create({ productId: p._id, price: p.price }); // first real price point
    created++;
  }
  const email = (process.env.ADMIN_EMAIL || 'admin@paypilot.dev').toLowerCase();
  if (!(await User.exists({ email }))) {
    await User.create({ name: 'PayPilot Admin', email, role: 'admin', passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'ChangeMe-Admin-123', 11) });
    console.log(`Admin created: ${email}`);
  }
  console.log(`Seed finished: ${created} new products.`);
  await mongoose.disconnect();
})();
