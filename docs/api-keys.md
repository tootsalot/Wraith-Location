# Optional API keys

Wraith works without any key. It uses free public services: Photon for search,
Valhalla (with OSRM as a fallback) for routes, and OpenStreetMap for the map. A
free key from a supported provider makes some of these better. Keys are optional,
are stored only on your computer, and never ship inside the app.

## Geoapify

One free Geoapify key covers all of its services. The free plan includes 3,000
credits a day, needs no credit card, and allows commercial use with some
limitations.

### What it changes in Wraith

| Feature | Without a key | With a Geoapify key | Credits |
| --- | --- | --- | --- |
| Place search | Photon | Geoapify geocoding, falling back to Photon if Geoapify fails | 1 per search |
| Dropped pin names | "Dropped pin" | The address, looked up when you set or save the pin | 1 per pin |

Wraith calls Geoapify only when you do something on purpose: submit a search, or
set or save a pin. Nothing runs in the background, on a timer or while you drag a
pin. Results aren't cached, so each action makes one fresh request. Checking a key
when you add it uses 1 credit. A typical day of 20 searches and 10 named pins uses
about 30 credits, about 1% of the free allowance.

### Get a key

1. Create a free account at [myprojects.geoapify.com](https://myprojects.geoapify.com/).
   Registration is for adults only.
2. Create a project. Geoapify shows the project's API key.
3. Copy the key.

### Add it to Wraith

1. Open **Settings** and scroll to **Free API keys**.
2. Paste the key into **Geoapify API key** and choose **Test and save**.
3. Wraith checks the key with one request. If Geoapify accepts it, the key is saved
   and search and pin names start using Geoapify.

**Replace key** swaps in a different key and **Remove key** deletes it. Without a
key, Wraith goes back to the free services.

### Usage and limits

Settings shows roughly how many credits Wraith has used today. Wraith counts them
itself, so the number covers only this computer. Geoapify's own dashboard is the
exact record.

- At 80% of the daily allowance, Wraith shows a warning.
- At the limit, or if Geoapify reports a rate limit, Wraith uses the free services
  until the count resets at midnight UTC. Nothing fails; search keeps working.
- If Geoapify rejects the key, Wraith also switches to the free services for the
  day and asks you to check the key in Settings.

### Your responsibilities

Geoapify's terms apply to your account.

- **One key per person.** Use your own key and never share it. The licence can't be
  transferred, and spreading requests across several accounts to stay on the free
  plan isn't allowed.
- **Stay within the limits.** Going over them repeatedly can suspend your account.
  Wraith's meter and its switch to the free services help with this.
- **Work use is commercial use.** The free plan limits commercial use in
  production. If you use Wraith for work, contact Geoapify
  ([info@geoapify.com](mailto:info@geoapify.com)) or choose a paid plan.
- **Credit.** While a key is set, Wraith shows "Powered by Geoapify" on the map
  and under search results, next to the OpenStreetMap credit.

### Where the key is stored

The key is saved in `providers.json` in Wraith's settings folder, encrypted with
your operating system's secure storage (Keychain on macOS, DPAPI on Windows, and
the desktop keyring, such as GNOME Keyring or KWallet, on Linux). Wraith never
writes a key in plain text. If secure storage isn't available, the key works until
you quit Wraith but isn't saved, and Settings tells you so. A key that Wraith 0.3.0
saved without encryption is encrypted the next time Wraith opens, or removed from
disk if secure storage still isn't available. The key is never sent to the interface or anywhere
except Geoapify's API.

### For developers

Put a Geoapify test key in `.env` as `GEOAPIFY_API_KEY` (see `.env.example`).
`npm run dev` uses it for that run only, without saving it, unless a key has been
added in Settings. Packaged builds ignore `.env`.
