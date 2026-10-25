// AUTO-GENERATED via `supabase gen types typescript --project-id wdqooznwzesmjdvlcrxw`.
// Do not edit by hand — re-run the command after any schema migration. The
// `<Database>` generic on `createClient` in `./supabase.ts` is what lets
// `.from('players').select()` infer the row shape; without this file every
// query returns `any` and we lose compile-time schema checks.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      categories: {
        Row: {
          age_band: string | null
          allow_solo_signup: boolean
          created_at: string
          groups_count: number
          has_bronze_match: boolean
          id: string
          match_minutes: number
          min_age: number | null
          name: string
          phase: string
          price: number | null
          price_basis: string
          rounds_per_pair: number
          sort_order: number
          starts_at: string | null
          team_size: number
          top_n_advance: number
          tournament_id: string
        }
        Insert: {
          age_band?: string | null
          allow_solo_signup?: boolean
          created_at?: string
          groups_count?: number
          has_bronze_match?: boolean
          id?: string
          match_minutes?: number
          min_age?: number | null
          name: string
          phase?: string
          price?: number | null
          price_basis?: string
          rounds_per_pair?: number
          sort_order?: number
          starts_at?: string | null
          team_size?: number
          top_n_advance?: number
          tournament_id: string
        }
        Update: {
          age_band?: string | null
          allow_solo_signup?: boolean
          created_at?: string
          groups_count?: number
          has_bronze_match?: boolean
          id?: string
          match_minutes?: number
          min_age?: number | null
          name?: string
          phase?: string
          price?: number | null
          price_basis?: string
          rounds_per_pair?: number
          sort_order?: number
          starts_at?: string | null
          team_size?: number
          top_n_advance?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      match_audit_log: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          changed_at: string
          changed_by: string | null
          changed_fields: string[] | null
          id: number
          match_id: string
          tournament_id: string | null
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: number
          match_id: string
          tournament_id?: string | null
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: number
          match_id?: string
          tournament_id?: string | null
        }
        Relationships: []
      }
      matches: {
        Row: {
          category_id: string
          confirmed: boolean
          confirmed_at: string | null
          court_allocated_at: string | null
          court_number: number | null
          created_at: string
          extended_minutes: number
          group_idx: number | null
          id: string
          is_bronze: boolean
          is_bye: boolean
          is_walkover: boolean
          queue_position: number | null
          round_idx: number | null
          scheduled_at: string | null
          score_a: number | null
          score_b: number | null
          slot_idx: number
          stage: string
          started_at: string | null
          status: string
          team_a_id: string | null
          team_b_id: string | null
          tournament_id: string
          winner_id: string | null
        }
        Insert: {
          category_id: string
          confirmed?: boolean
          confirmed_at?: string | null
          court_allocated_at?: string | null
          court_number?: number | null
          created_at?: string
          extended_minutes?: number
          group_idx?: number | null
          id?: string
          is_bronze?: boolean
          is_bye?: boolean
          is_walkover?: boolean
          queue_position?: number | null
          round_idx?: number | null
          scheduled_at?: string | null
          score_a?: number | null
          score_b?: number | null
          slot_idx: number
          stage: string
          started_at?: string | null
          status?: string
          team_a_id?: string | null
          team_b_id?: string | null
          tournament_id: string
          winner_id?: string | null
        }
        Update: {
          category_id?: string
          confirmed?: boolean
          confirmed_at?: string | null
          court_allocated_at?: string | null
          court_number?: number | null
          created_at?: string
          extended_minutes?: number
          group_idx?: number | null
          id?: string
          is_bronze?: boolean
          is_bye?: boolean
          is_walkover?: boolean
          queue_position?: number | null
          round_idx?: number | null
          scheduled_at?: string | null
          score_a?: number | null
          score_b?: number | null
          slot_idx?: number
          stage?: string
          started_at?: string | null
          status?: string
          team_a_id?: string | null
          team_b_id?: string | null
          tournament_id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team_a_id_fkey"
            columns: ["team_a_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team_b_id_fkey"
            columns: ["team_b_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          channel: string
          error_message: string | null
          id: string
          match_id: string
          player_id: string
          sent_at: string
          status: string
        }
        Insert: {
          channel: string
          error_message?: string | null
          id?: string
          match_id: string
          player_id: string
          sent_at?: string
          status: string
        }
        Update: {
          channel?: string
          error_message?: string | null
          id?: string
          match_id?: string
          player_id?: string
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_log_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_registrations: {
        Row: {
          admin_email_status: string | null
          admin_emailed_at: string | null
          amount_due_cents: number | null
          approval_email_status: string | null
          approval_emailed_at: string | null
          approved_partner_id: string | null
          approved_player_id: string | null
          approved_team_id: string | null
          card_payment_status: string | null
          category_id: string
          comments: string | null
          confirmation_email_status: string | null
          confirmation_emailed_at: string | null
          group_choice: string | null
          id: string
          paid_at: string | null
          partner_age: number | null
          partner_consent_token: string | null
          partner_email: string | null
          partner_fee_type: string | null
          partner_is_member: boolean | null
          partner_name: string | null
          partner_phone: string | null
          partner_waiver_email_status: string | null
          partner_waiver_emailed_at: string | null
          payment_method: string
          payment_paid_full_for_partner: boolean
          payment_reference: string | null
          player_age: number | null
          player_email: string
          player_fee_type: string | null
          player_is_member: boolean
          player_name: string
          player_phone: string | null
          raw_payload: Json
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          submitted_at: string
          tournament_id: string
        }
        Insert: {
          admin_email_status?: string | null
          admin_emailed_at?: string | null
          amount_due_cents?: number | null
          approval_email_status?: string | null
          approval_emailed_at?: string | null
          approved_partner_id?: string | null
          approved_player_id?: string | null
          approved_team_id?: string | null
          card_payment_status?: string | null
          category_id: string
          comments?: string | null
          confirmation_email_status?: string | null
          confirmation_emailed_at?: string | null
          group_choice?: string | null
          id?: string
          paid_at?: string | null
          partner_age?: number | null
          partner_consent_token?: string | null
          partner_email?: string | null
          partner_fee_type?: string | null
          partner_is_member?: boolean | null
          partner_name?: string | null
          partner_phone?: string | null
          partner_waiver_email_status?: string | null
          partner_waiver_emailed_at?: string | null
          payment_method?: string
          payment_paid_full_for_partner?: boolean
          payment_reference?: string | null
          player_age?: number | null
          player_email: string
          player_fee_type?: string | null
          player_is_member?: boolean
          player_name: string
          player_phone?: string | null
          raw_payload?: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          submitted_at?: string
          tournament_id: string
        }
        Update: {
          admin_email_status?: string | null
          admin_emailed_at?: string | null
          amount_due_cents?: number | null
          approval_email_status?: string | null
          approval_emailed_at?: string | null
          approved_partner_id?: string | null
          approved_player_id?: string | null
          approved_team_id?: string | null
          card_payment_status?: string | null
          category_id?: string
          comments?: string | null
          confirmation_email_status?: string | null
          confirmation_emailed_at?: string | null
          group_choice?: string | null
          id?: string
          paid_at?: string | null
          partner_age?: number | null
          partner_consent_token?: string | null
          partner_email?: string | null
          partner_fee_type?: string | null
          partner_is_member?: boolean | null
          partner_name?: string | null
          partner_phone?: string | null
          partner_waiver_email_status?: string | null
          partner_waiver_emailed_at?: string | null
          payment_method?: string
          payment_paid_full_for_partner?: boolean
          payment_reference?: string | null
          player_age?: number | null
          player_email?: string
          player_fee_type?: string | null
          player_is_member?: boolean
          player_name?: string
          player_phone?: string | null
          raw_payload?: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          submitted_at?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_registrations_approved_partner_id_fkey"
            columns: ["approved_partner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_registrations_approved_player_id_fkey"
            columns: ["approved_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_registrations_approved_team_id_fkey"
            columns: ["approved_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_registrations_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_registrations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      player_categories: {
        Row: {
          category_id: string
          created_at: string | null
          id: string
          player_id: string
        }
        Insert: {
          category_id: string
          created_at?: string | null
          id?: string
          player_id: string
        }
        Update: {
          category_id?: string
          created_at?: string | null
          id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_categories_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          active: boolean
          age: number | null
          checked_in_at: string | null
          color: string
          created_at: string
          email: string | null
          id: string
          name: string
          note: string | null
          photo_url: string | null
          sort_order: number
          tournament_id: string
        }
        Insert: {
          active?: boolean
          age?: number | null
          checked_in_at?: string | null
          color?: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          note?: string | null
          photo_url?: string | null
          sort_order?: number
          tournament_id: string
        }
        Update: {
          active?: boolean
          age?: number | null
          checked_in_at?: string | null
          color?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          note?: string | null
          photo_url?: string | null
          sort_order?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          admin_email: string | null
          auth: string
          created_at: string
          endpoint: string
          id: string
          kind: string
          last_error: string | null
          last_used_at: string
          p256dh: string
          pending_registration_id: string | null
          player_id: string | null
          tournament_id: string
          user_agent: string | null
        }
        Insert: {
          admin_email?: string | null
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          kind: string
          last_error?: string | null
          last_used_at?: string
          p256dh: string
          pending_registration_id?: string | null
          player_id?: string | null
          tournament_id: string
          user_agent?: string | null
        }
        Update: {
          admin_email?: string | null
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          kind?: string
          last_error?: string | null
          last_used_at?: string
          p256dh?: string
          pending_registration_id?: string | null
          player_id?: string | null
          tournament_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_pending_registration_id_fkey"
            columns: ["pending_registration_id"]
            isOneToOne: false
            referencedRelation: "pending_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          bucket: string
          created_at: string
          id: number
          key_hash: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: never
          key_hash: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: never
          key_hash?: string
        }
        Relationships: []
      }
      team_deletions: {
        Row: {
          category_id: string | null
          deleted_at: string
          deleted_by: string | null
          id: number
          p1_id: string | null
          p1_name: string | null
          p2_id: string | null
          p2_name: string | null
          reason: string
          team_id: string
          team_snapshot: Json
          tournament_id: string | null
        }
        Insert: {
          category_id?: string | null
          deleted_at?: string
          deleted_by?: string | null
          id?: never
          p1_id?: string | null
          p1_name?: string | null
          p2_id?: string | null
          p2_name?: string | null
          reason: string
          team_id: string
          team_snapshot: Json
          tournament_id?: string | null
        }
        Update: {
          category_id?: string | null
          deleted_at?: string
          deleted_by?: string | null
          id?: never
          p1_id?: string | null
          p1_name?: string | null
          p2_id?: string | null
          p2_name?: string | null
          reason?: string
          team_id?: string
          team_snapshot?: Json
          tournament_id?: string | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          category_id: string
          created_at: string
          id: string
          name: string
          p1_id: string
          p2_id: string | null
          sort_order: number
          tournament_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          name: string
          p1_id: string
          p2_id?: string | null
          sort_order?: number
          tournament_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          name?: string
          p1_id?: string
          p2_id?: string | null
          sort_order?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_p1_id_fkey"
            columns: ["p1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_p2_id_fkey"
            columns: ["p2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_admins: {
        Row: {
          added_at: string
          email: string
          id: string
        }
        Insert: {
          added_at?: string
          email: string
          id?: string
        }
        Update: {
          added_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      tournaments: {
        Row: {
          admin_notify_emails: string[] | null
          contact_info: string | null
          created_at: string
          created_by: string | null
          e_transfer_email: string | null
          event_date: string | null
          event_time: string | null
          fees: Json
          id: string
          name: string
          num_courts: number
          phase: string
          registration_deadline: string | null
          registration_open: boolean
          reply_to_email: string | null
          rounds_per_pair: number
          rules_url: string | null
          slug: string | null
          student_label: string | null
          student_price: number | null
          terms_text: string | null
          venue_address: string | null
          venue_map_url: string | null
          venue_name: string | null
          waiver_text: string | null
          waiver_url: string | null
          waiver_version: string | null
          youth_price: number | null
        }
        Insert: {
          admin_notify_emails?: string[] | null
          contact_info?: string | null
          created_at?: string
          created_by?: string | null
          e_transfer_email?: string | null
          event_date?: string | null
          event_time?: string | null
          fees?: Json
          id?: string
          name: string
          num_courts?: number
          phase?: string
          registration_deadline?: string | null
          registration_open?: boolean
          reply_to_email?: string | null
          rounds_per_pair?: number
          rules_url?: string | null
          slug?: string | null
          student_label?: string | null
          student_price?: number | null
          terms_text?: string | null
          venue_address?: string | null
          venue_map_url?: string | null
          venue_name?: string | null
          waiver_text?: string | null
          waiver_url?: string | null
          waiver_version?: string | null
          youth_price?: number | null
        }
        Update: {
          admin_notify_emails?: string[] | null
          contact_info?: string | null
          created_at?: string
          created_by?: string | null
          e_transfer_email?: string | null
          event_date?: string | null
          event_time?: string | null
          fees?: Json
          id?: string
          name?: string
          num_courts?: number
          phase?: string
          registration_deadline?: string | null
          registration_open?: boolean
          reply_to_email?: string | null
          rounds_per_pair?: number
          rules_url?: string | null
          slug?: string | null
          student_label?: string | null
          student_price?: number | null
          terms_text?: string | null
          venue_address?: string | null
          venue_map_url?: string | null
          venue_name?: string | null
          waiver_text?: string | null
          waiver_url?: string | null
          waiver_version?: string | null
          youth_price?: number | null
        }
        Relationships: []
      }
      waiver_consents: {
        Row: {
          accepted_at: string
          accepted_codes_of_conduct: boolean
          accepted_rules: boolean
          accepted_waiver: boolean
          guardian_name: string | null
          id: string
          ip_address: string | null
          participant_age: number
          participant_email: string | null
          participant_name: string
          registration_id: string | null
          role: string
          signature: string
          tournament_id: string
          user_agent: string | null
          waiver_sha256: string
          waiver_version: string
        }
        Insert: {
          accepted_at?: string
          accepted_codes_of_conduct: boolean
          accepted_rules: boolean
          accepted_waiver: boolean
          guardian_name?: string | null
          id?: string
          ip_address?: string | null
          participant_age: number
          participant_email?: string | null
          participant_name: string
          registration_id?: string | null
          role: string
          signature: string
          tournament_id: string
          user_agent?: string | null
          waiver_sha256: string
          waiver_version: string
        }
        Update: {
          accepted_at?: string
          accepted_codes_of_conduct?: boolean
          accepted_rules?: boolean
          accepted_waiver?: boolean
          guardian_name?: string | null
          id?: string
          ip_address?: string | null
          participant_age?: number
          participant_email?: string | null
          participant_name?: string
          registration_id?: string | null
          role?: string
          signature?: string
          tournament_id?: string
          user_agent?: string | null
          waiver_sha256?: string
          waiver_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiver_consents_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "pending_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_consents_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_players: {
        Args: { p_tournament_id: string }
        Returns: {
          active: boolean
          age: number | null
          checked_in_at: string | null
          color: string
          created_at: string
          email: string | null
          id: string
          name: string
          note: string | null
          photo_url: string | null
          sort_order: number
          tournament_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "players"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      allocate_court: {
        Args: { p_court: number; p_match_id: string }
        Returns: undefined
      }
      approve_registration: { Args: { p_reg_id: string }; Returns: Json }
      delete_team: {
        Args: { p_reason: string; p_team_id: string }
        Returns: undefined
      }
      extend_match: {
        Args: { p_extra_minutes: number; p_match_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      live_snapshot: { Args: { p_tournament_id: string }; Returns: Json }
      my_player: { Args: { p_tournament_id: string }; Returns: Json }
      rate_limit_hit: {
        Args: {
          p_bucket: string
          p_key: string
          p_max: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      reject_registration: {
        Args: { p_reason: string; p_reg_id: string }
        Returns: undefined
      }
      set_player_categories: {
        Args: { p_category_ids: string[]; p_player_id: string }
        Returns: undefined
      }
      slugify: { Args: { input: string }; Returns: string }
      start_category_stage: {
        Args: {
          p_category_id: string
          p_groups_count?: number | null
          p_matches: Json
          p_rounds_per_pair?: number | null
          p_stage: string
          p_top_n_advance?: number | null
        }
        Returns: number
      }
      start_match_on_court: {
        Args: { p_court: number; p_match_id: string }
        Returns: boolean
      }
      swap_match_queue_positions: {
        Args: { p_id1: string; p_id2: string; p_pos1: number; p_pos2: number }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
