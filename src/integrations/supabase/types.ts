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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          game_id: string | null
          id: number
          kind: string
          room_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          game_id?: string | null
          id?: never
          kind: string
          room_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          game_id?: string | null
          id?: never
          kind?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          away_code: string
          away_name: string
          away_score: number | null
          home_code: string
          home_name: string
          home_score: number | null
          id: string
          source: string
          start_utc: string
          state: string
          status_detail: string | null
          updated_at: string
        }
        Insert: {
          away_code: string
          away_name: string
          away_score?: number | null
          home_code: string
          home_name: string
          home_score?: number | null
          id: string
          source?: string
          start_utc: string
          state?: string
          status_detail?: string | null
          updated_at?: string
        }
        Update: {
          away_code?: string
          away_name?: string
          away_score?: number | null
          home_code?: string
          home_name?: string
          home_score?: number | null
          id?: string
          source?: string
          start_utc?: string
          state?: string
          status_detail?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          cents: number
          created_at: string
          id: string
          note: string | null
          payer_id: string
          recipient_id: string
          responded_at: string | null
          room_id: string
          status: string
        }
        Insert: {
          cents: number
          created_at?: string
          id?: string
          note?: string | null
          payer_id: string
          recipient_id: string
          responded_at?: string | null
          room_id: string
          status?: string
        }
        Update: {
          cents?: number
          created_at?: string
          id?: string
          note?: string | null
          payer_id?: string
          recipient_id?: string
          responded_at?: string | null
          room_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      picks: {
        Row: {
          created_at: string
          game_id: string
          room_id: string
          team_code: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          room_id: string
          team_code: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          room_id?: string
          team_code?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "picks_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      result_overrides: {
        Row: {
          away_score: number | null
          created_at: string
          entered_by: string
          game_id: string
          home_score: number | null
          room_id: string
          state: string
        }
        Insert: {
          away_score?: number | null
          created_at?: string
          entered_by: string
          game_id: string
          home_score?: number | null
          room_id: string
          state: string
        }
        Update: {
          away_score?: number | null
          created_at?: string
          entered_by?: string
          game_id?: string
          home_score?: number | null
          room_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_overrides_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_overrides_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_members: {
        Row: {
          display_name: string
          joined_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          display_name: string
          joined_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          display_name?: string
          joined_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          id: string
          invite_code: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_code: string
          name?: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_code?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          day: string
          game_count: number
          synced_at: string
        }
        Insert: {
          day: string
          game_count?: number
          synced_at?: string
        }
        Update: {
          day?: string
          game_count?: number
          synced_at?: string
        }
        Relationships: []
      }
      wagers: {
        Row: {
          accepted_by: string | null
          created_at: string
          game_id: string
          proposed_by: string
          room_id: string
          stake_each_cents: number
          status: string
          updated_at: string
        }
        Insert: {
          accepted_by?: string | null
          created_at?: string
          game_id: string
          proposed_by: string
          room_id: string
          stake_each_cents: number
          status: string
          updated_at?: string
        }
        Update: {
          accepted_by?: string | null
          created_at?: string
          game_id?: string
          proposed_by?: string
          room_id?: string
          stake_each_cents?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wagers_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wagers_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _log: {
        Args: { _detail: Json; _game: string; _kind: string; _room: string }
        Returns: undefined
      }
      _require_member: { Args: { _room: string }; Returns: undefined }
      _require_open: {
        Args: { _game: string }
        Returns: {
          away_code: string
          away_name: string
          away_score: number | null
          home_code: string
          home_name: string
          home_score: number | null
          id: string
          source: string
          start_utc: string
          state: string
          status_detail: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "games"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_wager: {
        Args: { p_game: string; p_room: string }
        Returns: undefined
      }
      clear_result_override: {
        Args: { p_game: string; p_room: string }
        Returns: undefined
      }
      create_room: {
        Args: { p_display_name: string; p_name: string }
        Returns: string
      }
      get_board: {
        Args: { p_from: string; p_room: string; p_to: string }
        Returns: {
          away_code: string
          away_name: string
          away_score: number
          game_id: string
          home_code: string
          home_name: string
          home_score: number
          my_pick: string
          opp_has_picked: boolean
          opp_pick: string
          overridden: boolean
          proposed_by: string
          provider_updated_at: string
          stake_each_cents: number
          start_utc: string
          state: string
          status_detail: string
          wager_status: string
        }[]
      }
      is_member: { Args: { _room: string }; Returns: boolean }
      join_room: {
        Args: { p_code: string; p_display_name: string }
        Returns: string
      }
      make_pick: {
        Args: { p_game: string; p_room: string; p_team: string }
        Returns: undefined
      }
      propose_wager: {
        Args: { p_cents: number; p_game: string; p_room: string }
        Returns: undefined
      }
      record_payment: {
        Args: { p_cents: number; p_note: string; p_room: string }
        Returns: undefined
      }
      rename_room: {
        Args: { p_name: string; p_room: string }
        Returns: undefined
      }
      respond_payment: {
        Args: { p_confirm: boolean; p_payment: string }
        Returns: undefined
      }
      respond_wager: {
        Args: { p_accept: boolean; p_game: string; p_room: string }
        Returns: undefined
      }
      set_display_name: {
        Args: { p_name: string; p_room: string }
        Returns: undefined
      }
      set_result_override: {
        Args: {
          p_away: number
          p_game: string
          p_home: number
          p_room: string
          p_state: string
        }
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
  public: {
    Enums: {},
  },
} as const
