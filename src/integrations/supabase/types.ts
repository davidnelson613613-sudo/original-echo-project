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
  public: {
    Tables: {
      alert_deliveries: {
        Row: {
          alert_key: string
          alert_kind: string
          created_at: string
          distance_pct: number
          email_status: string
          id: string
          live_price: number
          message: string
          phone_status: string
          symbol: string
          target_price: number
          user_id: string
        }
        Insert: {
          alert_key: string
          alert_kind: string
          created_at?: string
          distance_pct: number
          email_status?: string
          id?: string
          live_price: number
          message: string
          phone_status?: string
          symbol: string
          target_price: number
          user_id: string
        }
        Update: {
          alert_key?: string
          alert_kind?: string
          created_at?: string
          distance_pct?: number
          email_status?: string
          id?: string
          live_price?: number
          message?: string
          phone_status?: string
          symbol?: string
          target_price?: number
          user_id?: string
        }
        Relationships: []
      }
      analog_benchmarks: {
        Row: {
          baseline_diff: Json | null
          id: string
          ran_at: string
          results: Json
        }
        Insert: {
          baseline_diff?: Json | null
          id?: string
          ran_at?: string
          results: Json
        }
        Update: {
          baseline_diff?: Json | null
          id?: string
          ran_at?: string
          results?: Json
        }
        Relationships: []
      }
      analog_validation_runs: {
        Row: {
          config: Json | null
          id: string
          metrics: Json
          notes: string | null
          per_symbol: Json
          ran_at: string
          symbol_count: number
          test_dates_per_symbol: number
          total_predictions: number
          universe: string[]
        }
        Insert: {
          config?: Json | null
          id?: string
          metrics: Json
          notes?: string | null
          per_symbol: Json
          ran_at?: string
          symbol_count: number
          test_dates_per_symbol: number
          total_predictions: number
          universe: string[]
        }
        Update: {
          config?: Json | null
          id?: string
          metrics?: Json
          notes?: string | null
          per_symbol?: Json
          ran_at?: string
          symbol_count?: number
          test_dates_per_symbol?: number
          total_predictions?: number
          universe?: string[]
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          source: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          source?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: Json
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: Json
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_ingest_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          metadata: Json
          rows_upserted: number
          series_id: string | null
          source: string
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          rows_upserted?: number
          series_id?: string | null
          source: string
          started_at?: string
          status: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          rows_upserted?: number
          series_id?: string | null
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      edgar_facts_cache: {
        Row: {
          cik: string | null
          facts: Json
          symbol: string
          updated_at: string
        }
        Insert: {
          cik?: string | null
          facts: Json
          symbol: string
          updated_at?: string
        }
        Update: {
          cik?: string | null
          facts?: Json
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      finnhub_data_cache: {
        Row: {
          kind: string
          payload: Json
          symbol: string
          updated_at: string
        }
        Insert: {
          kind: string
          payload: Json
          symbol: string
          updated_at?: string
        }
        Update: {
          kind?: string
          payload?: Json
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      future_leaders_bar_cache: {
        Row: {
          as_of: string
          bar_count: number
          bars: Json
          fetched_at: string
          symbol: string
        }
        Insert: {
          as_of: string
          bar_count: number
          bars: Json
          fetched_at?: string
          symbol: string
        }
        Update: {
          as_of?: string
          bar_count?: number
          bars?: Json
          fetched_at?: string
          symbol?: string
        }
        Relationships: []
      }
      future_leaders_rankings: {
        Row: {
          ai_thesis: Json | null
          component_scores: Json
          composite_score: number
          confidence: number
          created_at: string
          deep_report: Json | null
          evidence: Json
          id: string
          rank: number
          snapshot_id: string
          symbol: string
        }
        Insert: {
          ai_thesis?: Json | null
          component_scores?: Json
          composite_score: number
          confidence: number
          created_at?: string
          deep_report?: Json | null
          evidence?: Json
          id?: string
          rank: number
          snapshot_id: string
          symbol: string
        }
        Update: {
          ai_thesis?: Json | null
          component_scores?: Json
          composite_score?: number
          confidence?: number
          created_at?: string
          deep_report?: Json | null
          evidence?: Json
          id?: string
          rank?: number
          snapshot_id?: string
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_leaders_rankings_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "future_leaders_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      future_leaders_snapshots: {
        Row: {
          created_at: string
          duration_ms: number | null
          eligible_size: number
          error_message: string | null
          failed_symbols: Json
          id: string
          processed_count: number
          regime: string | null
          scanned_at: string
          spy_change_pct: number | null
          status: string
          succeeded_count: number
          triggered_by: string | null
          universe_size: number
          weights: Json
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          eligible_size?: number
          error_message?: string | null
          failed_symbols?: Json
          id?: string
          processed_count?: number
          regime?: string | null
          scanned_at?: string
          spy_change_pct?: number | null
          status?: string
          succeeded_count?: number
          triggered_by?: string | null
          universe_size: number
          weights?: Json
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          eligible_size?: number
          error_message?: string | null
          failed_symbols?: Json
          id?: string
          processed_count?: number
          regime?: string | null
          scanned_at?: string
          spy_change_pct?: number | null
          status?: string
          succeeded_count?: number
          triggered_by?: string | null
          universe_size?: number
          weights?: Json
        }
        Relationships: []
      }
      market_events: {
        Row: {
          category: string
          created_at: string
          end_date: string | null
          id: string
          name: string
          notes: string | null
          peak_drawdown: number | null
          severity: string
          slug: string
          sources: Json
          start_date: string
          trough_date: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          end_date?: string | null
          id?: string
          name: string
          notes?: string | null
          peak_drawdown?: number | null
          severity?: string
          slug: string
          sources?: Json
          start_date: string
          trough_date?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          end_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          peak_drawdown?: number | null
          severity?: string
          slug?: string
          sources?: Json
          start_date?: string
          trough_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      market_features: {
        Row: {
          block: string
          confidence_tier: string
          created_at: string
          date: string
          feature_key: string
          id: number
          metadata: Json
          percentile: number | null
          value: number | null
          zscore: number | null
        }
        Insert: {
          block: string
          confidence_tier?: string
          created_at?: string
          date: string
          feature_key: string
          id?: number
          metadata?: Json
          percentile?: number | null
          value?: number | null
          zscore?: number | null
        }
        Update: {
          block?: string
          confidence_tier?: string
          created_at?: string
          date?: string
          feature_key?: string
          id?: number
          metadata?: Json
          percentile?: number | null
          value?: number | null
          zscore?: number | null
        }
        Relationships: []
      }
      market_scan_snapshots: {
        Row: {
          failed_count: number
          id: string
          payload: Json
          rows_count: number
          scanned_at: string
          spy_change_pct: number | null
          updated_at: string
          warning: string | null
        }
        Insert: {
          failed_count?: number
          id: string
          payload: Json
          rows_count?: number
          scanned_at: string
          spy_change_pct?: number | null
          updated_at?: string
          warning?: string | null
        }
        Update: {
          failed_count?: number
          id?: string
          payload?: Json
          rows_count?: number
          scanned_at?: string
          spy_change_pct?: number | null
          updated_at?: string
          warning?: string | null
        }
        Relationships: []
      }
      market_series: {
        Row: {
          created_at: string
          date: string
          id: number
          metadata: Json
          revision_date: string | null
          series_id: string
          source: string
          updated_at: string
          value: number | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: number
          metadata?: Json
          revision_date?: string | null
          series_id: string
          source: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: number
          metadata?: Json
          revision_date?: string | null
          series_id?: string
          source?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: []
      }
      momentum_rockets_rankings: {
        Row: {
          ai_thesis: Json | null
          component_scores: Json
          composite_score: number
          confidence: number
          created_at: string
          evidence: Json
          id: string
          rank: number
          snapshot_id: string
          symbol: string
        }
        Insert: {
          ai_thesis?: Json | null
          component_scores?: Json
          composite_score: number
          confidence: number
          created_at?: string
          evidence?: Json
          id?: string
          rank: number
          snapshot_id: string
          symbol: string
        }
        Update: {
          ai_thesis?: Json | null
          component_scores?: Json
          composite_score?: number
          confidence?: number
          created_at?: string
          evidence?: Json
          id?: string
          rank?: number
          snapshot_id?: string
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "momentum_rockets_rankings_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "momentum_rockets_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      momentum_rockets_snapshots: {
        Row: {
          created_at: string
          duration_ms: number | null
          eligible_size: number
          failed_symbols: Json
          id: string
          regime: string | null
          scanned_at: string
          spy_change_pct: number | null
          triggered_by: string | null
          universe_size: number
          weights: Json
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          eligible_size?: number
          failed_symbols?: Json
          id?: string
          regime?: string | null
          scanned_at?: string
          spy_change_pct?: number | null
          triggered_by?: string | null
          universe_size: number
          weights?: Json
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          eligible_size?: number
          failed_symbols?: Json
          id?: string
          regime?: string | null
          scanned_at?: string
          spy_change_pct?: number | null
          triggered_by?: string | null
          universe_size?: number
          weights?: Json
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          approach_threshold_pct: number
          approaching_buy_enabled: boolean
          at_buy_zone_enabled: boolean
          at_threshold_pct: number
          created_at: string
          digest_min_gap_minutes: number
          digests_enabled: boolean
          email_address: string | null
          email_enabled: boolean
          future_leaders_enabled: boolean
          last_digest_at: string | null
          min_pick_score: number
          new_picks_enabled: boolean
          phone_enabled: boolean
          phone_number: string | null
          price_level_enabled: boolean
          quiet_hours_enabled: boolean
          quiet_hours_end_min: number
          quiet_hours_start_min: number
          quiet_minutes: number
          system_alerts_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          approach_threshold_pct?: number
          approaching_buy_enabled?: boolean
          at_buy_zone_enabled?: boolean
          at_threshold_pct?: number
          created_at?: string
          digest_min_gap_minutes?: number
          digests_enabled?: boolean
          email_address?: string | null
          email_enabled?: boolean
          future_leaders_enabled?: boolean
          last_digest_at?: string | null
          min_pick_score?: number
          new_picks_enabled?: boolean
          phone_enabled?: boolean
          phone_number?: string | null
          price_level_enabled?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_end_min?: number
          quiet_hours_start_min?: number
          quiet_minutes?: number
          system_alerts_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          approach_threshold_pct?: number
          approaching_buy_enabled?: boolean
          at_buy_zone_enabled?: boolean
          at_threshold_pct?: number
          created_at?: string
          digest_min_gap_minutes?: number
          digests_enabled?: boolean
          email_address?: string | null
          email_enabled?: boolean
          future_leaders_enabled?: boolean
          last_digest_at?: string | null
          min_pick_score?: number
          new_picks_enabled?: boolean
          phone_enabled?: boolean
          phone_number?: string | null
          price_level_enabled?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_end_min?: number
          quiet_hours_start_min?: number
          quiet_minutes?: number
          system_alerts_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      position_settings: {
        Row: {
          auto_fill: boolean
          created_at: string
          recovery_capture: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_fill?: boolean
          created_at?: string
          recovery_capture?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_fill?: boolean
          created_at?: string
          recovery_capture?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          created_at: string
          entries: Json
          id: string
          planned_ladder: Json | null
          scenario: string
          symbol: string
          total_capital: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entries?: Json
          id?: string
          planned_ladder?: Json | null
          scenario: string
          symbol: string
          total_capital: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entries?: Json
          id?: string
          planned_ladder?: Json | null
          scenario?: string
          symbol?: string
          total_capital?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scan_reports: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          symbol: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload: Json
          symbol?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          symbol?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_alert_deliveries: {
        Row: {
          details: string | null
          event: string
          event_key: string
          level: string
          sent_at: string
        }
        Insert: {
          details?: string | null
          event: string
          event_key: string
          level: string
          sent_at?: string
        }
        Update: {
          details?: string | null
          event?: string
          event_key?: string
          level?: string
          sent_at?: string
        }
        Relationships: []
      }
      systemic_risk_backtest_runs: {
        Row: {
          created_at: string
          id: string
          per_event: Json
          run_label: string
          summary: Json
          timeline: Json
        }
        Insert: {
          created_at?: string
          id?: string
          per_event: Json
          run_label: string
          summary: Json
          timeline: Json
        }
        Update: {
          created_at?: string
          id?: string
          per_event?: Json
          run_label?: string
          summary?: Json
          timeline?: Json
        }
        Relationships: []
      }
      systemic_risk_snapshots: {
        Row: {
          as_of: string
          created_at: string
          data_coverage: Json
          disagreements: Json
          drivers: Json
          early_warning_score: number
          id: string
          indicators: Json
          probabilities: Json
          regime: string
          top_analogs: Json
          updated_at: string
        }
        Insert: {
          as_of: string
          created_at?: string
          data_coverage: Json
          disagreements: Json
          drivers: Json
          early_warning_score: number
          id?: string
          indicators: Json
          probabilities: Json
          regime: string
          top_analogs: Json
          updated_at?: string
        }
        Update: {
          as_of?: string
          created_at?: string
          data_coverage?: Json
          disagreements?: Json
          drivers?: Json
          early_warning_score?: number
          id?: string
          indicators?: Json
          probabilities?: Json
          regime?: string
          top_analogs?: Json
          updated_at?: string
        }
        Relationships: []
      }
      systemic_risk_v2_backtests: {
        Row: {
          id: string
          lead_time_stats: Json
          metrics: Json
          notes: string | null
          ran_at: string
          reliability_bins: Json
          scope_end: string
          scope_start: string
        }
        Insert: {
          id?: string
          lead_time_stats?: Json
          metrics: Json
          notes?: string | null
          ran_at?: string
          reliability_bins?: Json
          scope_end: string
          scope_start: string
        }
        Update: {
          id?: string
          lead_time_stats?: Json
          metrics?: Json
          notes?: string | null
          ran_at?: string
          reliability_bins?: Json
          scope_end?: string
          scope_start?: string
        }
        Relationships: []
      }
      systemic_risk_v2_snapshots: {
        Row: {
          analog_matches: Json
          as_of: string
          composite_score: number
          computation_ms: number | null
          computed_at: string
          confidence: number
          feature_snapshot: Json
          id: string
          missing_data: Json
          model_contributions: Json
          regime_label: string
          top_contributors: Json
        }
        Insert: {
          analog_matches?: Json
          as_of: string
          composite_score: number
          computation_ms?: number | null
          computed_at?: string
          confidence?: number
          feature_snapshot?: Json
          id?: string
          missing_data?: Json
          model_contributions?: Json
          regime_label: string
          top_contributors?: Json
        }
        Update: {
          analog_matches?: Json
          as_of?: string
          composite_score?: number
          computation_ms?: number | null
          computed_at?: string
          confidence?: number
          feature_snapshot?: Json
          id?: string
          missing_data?: Json
          model_contributions?: Json
          regime_label?: string
          top_contributors?: Json
        }
        Relationships: []
      }
      telegram_chats: {
        Row: {
          chat_id: number
          created_at: string
          is_active: boolean
          label: string | null
          updated_at: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          is_active?: boolean
          label?: string | null
          updated_at?: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          is_active?: boolean
          label?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      telegram_config: {
        Row: {
          chat_id: number | null
          created_at: string
          digest_min_gap_minutes: number
          digests_enabled: boolean
          future_leaders_enabled: boolean
          id: number
          min_pick_score: number
          new_picks_enabled: boolean
          owner_user_id: string | null
          price_level_enabled: boolean
          quiet_hours_enabled: boolean
          quiet_hours_end_min: number
          quiet_hours_start_min: number
          system_alerts_enabled: boolean
          updated_at: string
        }
        Insert: {
          chat_id?: number | null
          created_at?: string
          digest_min_gap_minutes?: number
          digests_enabled?: boolean
          future_leaders_enabled?: boolean
          id: number
          min_pick_score?: number
          new_picks_enabled?: boolean
          owner_user_id?: string | null
          price_level_enabled?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_end_min?: number
          quiet_hours_start_min?: number
          system_alerts_enabled?: boolean
          updated_at?: string
        }
        Update: {
          chat_id?: number | null
          created_at?: string
          digest_min_gap_minutes?: number
          digests_enabled?: boolean
          future_leaders_enabled?: boolean
          id?: number
          min_pick_score?: number
          new_picks_enabled?: boolean
          owner_user_id?: string | null
          price_level_enabled?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_end_min?: number
          quiet_hours_start_min?: number
          system_alerts_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      telegram_link_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_links: {
        Row: {
          chat_id: number
          linked_at: string
          telegram_username: string | null
          user_id: string
        }
        Insert: {
          chat_id: number
          linked_at?: string
          telegram_username?: string | null
          user_id: string
        }
        Update: {
          chat_id?: number
          linked_at?: string
          telegram_username?: string | null
          user_id?: string
        }
        Relationships: []
      }
      yahoo_summary_cache: {
        Row: {
          summary: Json
          symbol: string
          updated_at: string
        }
        Insert: {
          summary: Json
          symbol: string
          updated_at?: string
        }
        Update: {
          summary?: Json
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
