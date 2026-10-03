import { Agent, routeAgentRequest, type Connection, type ConnectionContext } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS, type VoiceTurnContext } from "@cloudflare/voice";
import { fetchSnapshot, resolveTournamentIdBySlug } from "./snapshot";
import {
  answerCourts,
  answerLookup,
  answerMatchForName,
  answerMyNextMatch,
  answerResults,
  answerRules,
  answerStandings,
  answerTournamentInfo,
  answerUpcoming,
} from "./tools";
import type { Env, Snapshot } from "./types";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

const TOOLS: ToolDef[] = [
  {
    name: "get_standings",
    description:
      "Group standings / who is leading a group. Use for questions like 'who's leading group B', 'standings for group A'.",
    parameters: {
      type: "object",
      properties: {
        group: { type: "string", description: "Group letter, e.g. A, B, C" },
        category: { type: "string", description: "Optional category name, e.g. 'Mixed Doubles'" },
      },
      required: ["group"],
    },
  },
  {
    name: "get_my_next_match",
    description:
      "The CURRENT speaker's own next or current match — court and time. Use when the speaker refers to themselves: 'my next match', 'what court am I on', 'when do I play'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_match_for",
    description:
      "Next or current match (court + time) for a NAMED player or team: 'when does team Smashers play', 'what court is Ashish on'.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Player or team name" } },
      required: ["name"],
    },
  },
  {
    name: "lookup",
    description:
      "Full detail about a NAMED team or player: their roster/partner, win-loss record, recent match scores, and their next match. Use for 'who is on team X', 'who is Ashish's partner', 'what's X's record', 'did X win', 'how has X done'.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Player or team name" } },
      required: ["name"],
    },
  },
  {
    name: "get_courts",
    description:
      "What is happening on the courts RIGHT NOW — live matches and their scores, who's warming up, which courts are free. Use for 'what's on court 2', 'what's the score on court 1', 'which courts are free', 'what's playing'.",
    parameters: {
      type: "object",
      properties: { court: { type: "number", description: "Optional single court number to focus on" } },
      required: [],
    },
  },
  {
    name: "get_results",
    description:
      "Recently FINISHED matches and their scores. Use for 'what just finished', 'who won the last match', 'recent results', 'latest scores'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_upcoming",
    description:
      "The next matches scheduled to start soon across the tournament. Use for 'what's coming up', 'what's next', 'upcoming matches', 'what matches are soon', 'the schedule'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_tournament_info",
    description:
      "Overall tournament facts: number of players, teams and courts, current stage, and how many matches are done. Use for 'how many teams', 'how many players', 'what stage are we in', 'how far along are we'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_rules",
    description:
      "Rules, format, scoring, or category details. Use for 'rules for mixed doubles', 'how does scoring work', 'how many groups'.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string", description: "Optional category or topic" } },
      required: [],
    },
  },
];

interface Identity {
  tournamentId: string | null;
  playerId: string | null;
}

interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

const VoiceAgent = withVoice(Agent<Env>);

export class BadmintonVoiceAgent extends VoiceAgent {
  transcriber = new WorkersAIFluxSTT(this.env.AI, {
    keyterms: ["badminton", "court", "group", "standings", "doubles", "singles", "mixed", "match"],
  });
  tts = new WorkersAITTS(this.env.AI, { speaker: "asteria" });

  // Per-connection identity (tournamentId + playerId), parsed from query params.
  // playerId is a convenience hint from the client, not an authenticated identity.
  #identity = new Map<string, Identity>();
  // Short-lived snapshot cache to avoid re-fetching within a rapid back-and-forth.
  #cache: { id: string; data: Snapshot; at: number } | null = null;

  onConnect(connection: Connection, ctx: ConnectionContext) {
    try {
      const url = new URL(ctx.request.url);
      this.#identity.set(connection.id, {
        tournamentId: url.searchParams.get("tournamentId"),
        playerId: url.searchParams.get("playerId"),
      });
    } catch {
      this.#identity.set(connection.id, { tournamentId: null, playerId: null });
    }
  }

  onClose(connection: Connection) {
    this.#identity.delete(connection.id);
  }

  async getSnapshot(tournamentId: string): Promise<Snapshot> {
    const now = Date.now();
    if (this.#cache && this.#cache.id === tournamentId && now - this.#cache.at < 8_000) {
      return this.#cache.data;
    }
    const data = await fetchSnapshot(this.env, tournamentId);
    this.#cache = { id: tournamentId, data, at: now };
    return data;
  }

  // The client sends a UUID or a public slug.
  async resolveTournamentId(id: Identity): Promise<string | null> {
    if (id.tournamentId) {
      if (/^[0-9a-f-]{36}$/i.test(id.tournamentId)) return id.tournamentId;
      return (await resolveTournamentIdBySlug(this.env, id.tournamentId)) ?? null;
    }
    return this.env.DEFAULT_TOURNAMENT_ID || null;
  }

  async onTurn(transcript: string, context: VoiceTurnContext): Promise<string> {
    const identity = this.#identity.get(context.connection.id) ?? { tournamentId: null, playerId: null };
    const tournamentId = await this.resolveTournamentId(identity);
    if (!tournamentId) {
      return "I'm not sure which tournament you're asking about. Please try again from the tournament page.";
    }
    let snap: Snapshot;
    try {
      snap = await this.getSnapshot(tournamentId);
    } catch {
      return "I'm having trouble reaching the tournament data right now. Please try again in a moment.";
    }
    if (!snap.tournament) {
      return "I couldn't find that tournament.";
    }
    const now = Date.now();
    const system = [
      `You are the friendly voice assistant for ${snap.tournament.name}, a live badminton tournament.`,
      `For every question, call the single most relevant tool — that's how you get live data (scores, courts, results, upcoming, standings, a team or player's detail, tournament facts, or rules).`,
      identity.playerId
        ? `The speaker is a known player; "my match" / "my next match" means theirs (get_my_next_match).`
        : `The speaker is not identified; if they ask about "my match", use get_my_next_match (it will ask them to name their team).`,
      `Only skip tools for a pure greeting or thanks. Keep any spoken reply to one short sentence.`,
    ].join(" ");
    const messages = [
      { role: "system", content: system },
      ...context.messages.slice(-4),
      { role: "user", content: transcript },
    ];
    let result: { response?: string; tool_calls?: ToolCall[] };
    try {
      result = (await this.env.AI.run(MODEL, { messages, tools: TOOLS, max_tokens: 256 })) as typeof result;
    } catch {
      return "Sorry, I had trouble with that. Could you ask again?";
    }
    const call = result.tool_calls?.[0];
    if (call) {
      const args = call.arguments ?? {};
      try {
        switch (call.name) {
          case "get_standings":
            return answerStandings(snap, String(args.group ?? ""), args.category ? String(args.category) : undefined);
          case "get_my_next_match":
            return answerMyNextMatch(snap, identity.playerId, now);
          case "get_match_for":
            return answerMatchForName(snap, String(args.name ?? ""), now);
          case "lookup":
            return answerLookup(snap, String(args.name ?? ""), now);
          case "get_courts":
            return answerCourts(
              snap,
              now,
              typeof args.court === "number" ? args.court : Number(args.court) || undefined,
            );
          case "get_results":
            return answerResults(snap);
          case "get_upcoming":
            return answerUpcoming(snap, now);
          case "get_tournament_info":
            return answerTournamentInfo(snap);
          case "get_rules":
            return answerRules(snap, args.topic ? String(args.topic) : undefined);
        }
      } catch {
        return "Sorry, I couldn't work that out just now.";
      }
    }
    // Llama sometimes answers in prose or with filler; only speak it if it looks sane.
    const said = (result.response ?? "").trim();
    const looksCanned = /input.*(insufficient|lacking|not sufficient)|provide more/i.test(said);
    const looksGarbage = /(.{2,20}?)\1{2,}/.test(said) || !/[a-z]/i.test(said);
    if (said && !looksCanned && !looksGarbage) return said;
    return "I can tell you about live scores, courts, standings, upcoming matches, results, or the rules — what would you like to know?";
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routeAgentRequest(request, env, { cors: true })) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
