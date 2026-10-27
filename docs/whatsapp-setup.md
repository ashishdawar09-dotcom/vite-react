# WhatsApp messages: setup

The app can send two WhatsApp messages to registered players:

- **The evening before** (6–9 pm Pacific): "Get ready: *Tournament* is tomorrow", with the start time and venue. One message per phone number.
- **On game day**: "you're up now on *Court N*", when an admin assigns a court. This goes out with the email and push that `notify-court-allocated` already sends.

Messages go through [Evolution API](https://github.com/EvolutionAPI/evolution-api), a server we host ourselves. It's linked to a spare phone the same way WhatsApp Web is, so there's no per-message cost.

Nothing is sent until all three are in place:

1. the Evolution server is running and linked to the phone,
2. the `EVOLUTION_*` secrets are set on Supabase,
3. **WhatsApp messages** is ticked in the tournament's settings (Edit → Player messages).

If any of them is missing, WhatsApp is skipped. Email and push still go out.

## Before you start: the risks

- This is not Meta's official API. WhatsApp can ban the number. That's most likely when an account sends lots of messages fast to people who haven't saved the number. **Use a spare SIM, never a personal number.** The code waits a few seconds between messages and only messages people who registered.
- The phone has to stay linked. If WhatsApp logs the session out, you scan a QR code again.
- Evolution API's license (Apache 2.0 plus extra terms) requires keeping their logo in their manager screens, and showing admins that Evolution API is used. The tournament settings checkbox mentions it. As a courtesy, email suporte@evofoundation.com.br to say you're using it.

## 1. The phone

1. Put the spare SIM in a phone and install **WhatsApp Business** (free). Set the profile name to "Shuttle Storm" and add the logo, so players see who's messaging them.
2. Use the number normally for a few days before the event: save a few contacts and chat with them. Brand-new numbers that start sending straight away get banned more often.
3. On tournament days, keep the phone charged, on Wi-Fi, and with WhatsApp installed. It doesn't need to be open.

## 2. The server

Pick one.

**A. Oracle Cloud "Always Free" VM (runs all the time, free permanently).**
Create an *Ampere A1* (ARM) instance with Ubuntu, 1 OCPU / 6 GB RAM is plenty. Install Docker:
`curl -fsSL https://get.docker.com | sh`.

**B. A laptop, only on the two days.**
Install Docker Desktop (it isn't installed on Ashish's Mac yet). The laptop must stay awake and online from the evening before until the last match.

Then, on either one, make a folder with these two files.

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

Evolution keeps its own small Postgres in the same folder. It doesn't touch the tournament database.

## 3. A public address (Cloudflare Tunnel, free)

Supabase needs to reach the server over HTTPS. adawar.org is already on Cloudflare, so:

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** (type *Cloudflared*). Name it `whatsapp`.
2. Run the install command it shows on the server or laptop.
3. Add a **public hostname**: `wa.adawar.org` → service `HTTP` → `localhost:8080`.

Every request needs the API key (password 2), so the address being public is fine.

## 4. Link the phone

1. Open `https://wa.adawar.org/manager` and log in with the API key.
2. **Create instance**: name `shuttlestorm`, channel *Baileys*.
3. Open the instance, get the QR code, and on the phone go to **WhatsApp → Settings → Linked devices → Link a device** and scan it.
4. The instance should show **open** / connected.

## 5. Supabase secrets and deploy

From the `vite-react` repo:

```bash
supabase secrets set EVOLUTION_API_URL=https://wa.adawar.org EVOLUTION_API_KEY=<password 2> EVOLUTION_INSTANCE=shuttlestorm
```

The migration creates the secret the database uses to call the reminder function. Copy it into the function's secrets without printing it:

```bash
supabase secrets set WHATSAPP_REMINDER_SECRET="$(supabase db query --linked -o csv "select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_reminder_secret'" 2>/dev/null | tail -1)"
```

Deploy (the migration first):

```bash
supabase db push
supabase functions deploy whatsapp-reminders notify-court-allocated
```

## 6. Test it

As an admin, call the reminder function with your own access token (in the admin app's browser console: `JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('-auth-token')))).access_token`).

Dry run, which shows who would get the message and who has no usable number, and sends nothing:

```bash
curl -s -X POST https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-reminders -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","dry_run":true}'
```

Send the day-before message to one number only:

```bash
curl -s -X POST https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/whatsapp-reminders -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"tournament_id":"<id>","test_number":"778 555 0123"}'
```

Then tick **WhatsApp messages** in the tournament settings.

## How it works

- **Phone numbers** come from approved registrations (`player_phone`, `partner_phone`). Ten-digit numbers get the `1` country code. Numbers that can't be right are skipped, never guessed. The dry run lists those players.
- **Day before**: pg_cron runs `queue_whatsapp_reminders()` every 5 minutes. Between 6 and 9 pm Pacific on the day before a tournament with WhatsApp on, it calls `whatsapp-reminders`. Each call sends up to 8 messages, 5–9 seconds apart, and the next call carries on. Each number is recorded in `whatsapp_reminders` before sending, so nobody gets it twice. A failed send is retried on later calls, 3 tries in total.
- **Court calls**: `notify-court-allocated` sends one message per number on the match, 1–2.5 s apart. Results are in `notification_log` with `channel = 'whatsapp'`.
- **To stop everything**: untick the setting, or `supabase secrets unset EVOLUTION_API_URL`.

## Tournament day

- Before the first match, check the instance shows connected in `/manager`. If it doesn't, scan the QR code again.
- If a player asks to stop getting messages, remove the phone number from their entry, or untick the setting. There's no "reply STOP" handling.
