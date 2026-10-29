# WhatsApp updates: setup

Players can choose to get two kinds of WhatsApp message:

- **The evening before** (6–9 pm Pacific): "Get ready: *Tournament* is tomorrow", with the start time and venue.
- **On game day**: "you're up now on *Court N*", when an admin assigns a court. This goes out alongside the email and push that `notify-court-allocated` already sends.

**Opt-in only.** The registration confirmation screen has a **Get updates on WhatsApp** button. It opens WhatsApp with a message to the club number holding the player's code, e.g. *"Hi! Please send me WhatsApp updates for Shuttle Storm. My code: 1A2B3C4D"*. Sending it is the opt-in. We reply once to confirm, and players can send STOP (or START) at any time. Anyone who hasn't messaged us first is never messaged.

Messages go through [Evolution API](https://github.com/EvolutionAPI/evolution-api), a server we host ourselves. It's linked to a spare phone the same way WhatsApp Web is, so there's no per-message cost.

Nothing is sent until all of these are in place:

1. the Evolution server is running, linked to the phone, with its webhook pointing at us,
2. the Supabase secrets are set and the functions deployed,
3. **WhatsApp updates** is ticked and the **club WhatsApp number** filled in, in the tournament's settings (Edit → Player messages).

Until then the button doesn't show, and email and push work as before.

## Before you start: the risks

- This is not Meta's official API. WhatsApp can ban the number, even when it's used gently. Opt-in keeps the risk low: we only message people who wrote to us first, who are unlikely to report us. **Use a spare SIM, ideally in a spare phone, never a personal number.** If the number is banned, email and push still go out and the tournament carries on.
- The phone has to stay linked. If WhatsApp logs the session out, you scan the QR code again.
- Evolution API's license (Apache 2.0 plus extra terms) requires keeping their logo in their manager screens, and showing admins that Evolution API is used. The tournament settings checkbox mentions it. As a courtesy, email suporte@evofoundation.com.br to say you're using it.

## 1. The phone

1. Put the spare SIM in a phone and install **WhatsApp Business** (free). Set the profile name to "Shuttle Storm" and add the logo, so players see who they're writing to.
2. Use the number normally for a few days before switching the button on: save a few contacts and chat with them. Brand-new numbers that start sending straight away get banned more often.
3. Keep the phone charged and online with WhatsApp installed. It doesn't need to be open.

People will also write to this number with questions. Those get no automatic reply. Read and answer them on the phone as normal.

## 2. The server (runs all the time)

Opt-ins arrive whenever people register, so the server has to run continuously from the day the button goes live, not only on tournament days. Use the **Oracle Cloud "Always Free" VM** (free permanently): an *Ampere A1* (ARM) instance with Ubuntu, 1 OCPU / 6 GB RAM is plenty. Install Docker:
`curl -fsSL https://get.docker.com | sh`.

Make a folder with these two files.

`docker-compose.yml`:

```yaml
services:
  api:
    image: evoapicloud/evolution-api:v2.3.7
    restart: always
    depends_on: [postgres]
    ports:
      - "127.0.0.1:8080:8080"   # only reachable through the tunnel below
    env_file: .env
    volumes:
      - evolution_instances:/evolution/instances

  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  evolution_instances:
  postgres_data:
```

`.env` (fill in the two passwords; generate each with `openssl rand -hex 24`):

```
POSTGRES_PASSWORD=<password 1>
SERVER_URL=https://wa.adawar.org
AUTHENTICATION_API_KEY=<password 2>
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:<password 1>@postgres:5432/evolution?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=evolution
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
CONFIG_SESSION_PHONE_CLIENT=Shuttle Storm
CONFIG_SESSION_PHONE_NAME=Chrome
```

Start it with `docker compose up -d`. Check `docker compose logs -f api` until it says it's listening on 8080.

Evolution keeps its own small Postgres on the VM. It doesn't touch the tournament database.

## 3. A public address (Cloudflare Tunnel, free)

Supabase needs to reach the server over HTTPS. adawar.org is already on Cloudflare, so:

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** (type *Cloudflared*). Name it `whatsapp`.
2. Run the install command it shows on the VM.
3. Add a **public hostname**: `wa.adawar.org` → service `HTTP` → `localhost:8080`.

Every request needs the API key (password 2), so the address being public is fine.

## 4. Link the phone

1. Open `https://wa.adawar.org/manager` and log in with the API key.
2. **Create instance**: name `shuttlestorm`, channel *Baileys*.
3. Open the instance, get the QR code, and on the phone go to **WhatsApp → Settings → Linked devices → Link a device** and scan it.
4. The instance should show **open** / connected.

## 5. Supabase: deploy and secrets

From the `vite-react` repo, the migration first:

```bash
supabase db push
```

```bash
supabase functions deploy whatsapp-inbound whatsapp-send whatsapp-reminders notify-court-allocated
```

Generate the webhook secret (password 3) with `openssl rand -hex 24`, then:

```bash
supabase secrets set EVOLUTION_API_URL=https://wa.adawar.org EVOLUTION_API_KEY=<password 2> EVOLUTION_INSTANCE=shuttlestorm WHATSAPP_WEBHOOK_SECRET=<password 3>
```

The migration created the secret the database uses to wake the functions. Copy it into the functions' secrets without printing it:

```bash
supabase secrets set WHATSAPP_INTERNAL_SECRET="$(supabase db query --linked -o csv "select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_internal_secret'" 2>/dev/null | tail -1)"
```

## 6. Point Evolution's webhook at us

This tells Evolution to forward incoming messages (the opt-ins, STOP, START) to `whatsapp-inbound`:

```bash
curl -s -X POST https://wa.adawar.org/webhook/set/shuttlestorm \
  -H "apikey: <password 2>" -H "Content-Type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-inbound","headers":{"x-webhook-secret":"<password 3>"},"byEvents":false,"base64":false,"events":["MESSAGES_UPSERT"]}}'
```

## 7. Test it, then switch it on

1. In the tournament settings, fill in the **club WhatsApp number** and tick **WhatsApp updates**.
2. From your own phone, send the club number `My code: <code>`, using the first 8 characters of one of your own registrations' IDs. You should get the ✅ reply within a minute. Send `STOP`, then `START`, and check you get those replies too.
3. Dry run: who would get the day-before message, and who hasn't opted in. Nothing is sent. Use your admin access token (in the admin app's browser console: `JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('-auth-token')))).access_token`):

```bash
curl -s -X POST https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-reminders -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","dry_run":true}'
```

To see what the day-before message looks like, send it to **your own number** only. This one skips the opt-in, so never use it for anyone else:

```bash
curl -s -X POST https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-reminders -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","test_number":"778 555 0123"}'
```

## How it works

- **Opt-in** (`whatsapp-inbound`): the code is the first 8 characters of the registration ID. The opt-in is stored in `whatsapp_optins` with the chat it came from, and updates go to that chat. A player can opt in before their entry is approved; they get updates once it is. STOP sets `opted_out_at` for every entry on that chat and cancels anything queued for it. START clears it.
- **Queue** (`whatsapp_outbox`, `whatsapp-send`): every message is queued, then sent one at a time by a single sender, 2–4 s apart (5–9 s for day-before messages). Replies and court calls go first. A failed message is retried a minute later, 3 tries in total. A court call still unsent after 20 minutes is dropped, since "you're up now" would be wrong by then. Moving a match to another court cancels its unsent call. The functions wake the sender when they queue something, and pg_cron checks every minute as a backstop.
- **Day before**: between 6 and 9 pm Pacific on the day before a tournament with WhatsApp on, pg_cron calls `whatsapp-reminders` every 5 minutes. Each chat is queued once, so people who opt in that evening still get it.
- **Court calls**: `notify-court-allocated` queues one message per chat on the match. Results are in `notification_log` with `channel = 'whatsapp'`. Players who haven't opted in are logged as skipped.
- **Doubles partners** can't opt in yet: the button is only on the confirmation screen of the person who registered.
- **To stop everything**: untick the setting, or `supabase secrets unset EVOLUTION_API_URL`.

## Tournament day

- Before the first match, check the instance shows connected in `/manager`. If it doesn't, scan the QR code again.
- `select status, count(*) from whatsapp_outbox group by 1;` shows whether anything is stuck or failing.
