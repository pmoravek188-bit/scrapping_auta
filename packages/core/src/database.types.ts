/**
 * Hand-written Supabase database types matching
 * supabase/migrations/20260928120000_init.sql.
 *
 * The parent project may regenerate this file with
 * `supabase gen types typescript` once the migration has been applied to the
 * remote project — the shape should match closely.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      sources: {
        Row: {
          id: string;
          name: string;
          enabled: boolean;
          needs_browser: boolean;
          last_run_at: string | null;
          last_ok_at: string | null;
          last_count: number | null;
          last_alert_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["sources"]["Row"]> & { id: string };
        Update: Partial<Database["public"]["Tables"]["sources"]["Row"]>;
        Relationships: [];
      };
      searches: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          enabled: boolean;
          make: string | null;
          model: string | null;
          year_from: number | null;
          year_to: number | null;
          price_from: number | null;
          price_to: number | null;
          mileage_max: number | null;
          fuel: string[];
          transmission: string | null;
          body: string[];
          power_min_kw: number | null;
          keywords: string[];
          exclude_keywords: string[];
          sources: string[];
          drive: string[];
          features: string[];
          notify: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["searches"]["Row"]> & {
          user_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["searches"]["Row"]>;
        Relationships: [];
      };
      listings: {
        Row: {
          id: string;
          source: string;
          source_id: string;
          url: string;
          title: string;
          make: string | null;
          model: string | null;
          variant: string | null;
          year: number | null;
          mileage_km: number | null;
          price_czk: number | null;
          price_orig: number | null;
          currency_orig: string;
          fuel: string | null;
          transmission: string | null;
          power_kw: number | null;
          body: string | null;
          color: string | null;
          location: string | null;
          country: string;
          seller_type: string;
          vin: string | null;
          image_urls: string[];
          drive: string | null;
          equipment: string[];
          detail_features: string[];
          first_seen: string;
          last_seen: string;
          is_active: boolean;
          fingerprint: string;
          group_id: string | null;
          created_at: string;
          gone_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["listings"]["Row"]> & {
          source: string;
          source_id: string;
          url: string;
          fingerprint: string;
        };
        Update: Partial<Database["public"]["Tables"]["listings"]["Row"]>;
        Relationships: [];
      };
      detail_text_cache: {
        Row: {
          source: string;
          source_id: string;
          features: string[];
          fetched_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["detail_text_cache"]["Row"]> & {
          source: string;
          source_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["detail_text_cache"]["Row"]>;
        Relationships: [];
      };
      price_history: {
        Row: {
          id: number;
          listing_id: string;
          price_czk: number | null;
          seen_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["price_history"]["Row"]> & {
          listing_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["price_history"]["Row"]>;
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          search_id: string;
          listing_id: string;
          matched_at: string;
          notified_at: string | null;
          status: "new" | "favorite" | "hidden";
        };
        Insert: Partial<Database["public"]["Tables"]["matches"]["Row"]> & {
          search_id: string;
          listing_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["matches"]["Row"]>;
        Relationships: [];
      };
      scrape_runs: {
        Row: {
          id: string;
          source: string;
          started_at: string;
          finished_at: string | null;
          found: number;
          new: number;
          errors: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["scrape_runs"]["Row"]> & { source: string };
        Update: Partial<Database["public"]["Tables"]["scrape_runs"]["Row"]>;
        Relationships: [];
      };
      exchange_rates: {
        Row: {
          rate_date: string;
          eur_czk: number;
        };
        Insert: Database["public"]["Tables"]["exchange_rates"]["Row"];
        Update: Partial<Database["public"]["Tables"]["exchange_rates"]["Row"]>;
        Relationships: [];
      };
      user_state: {
        Row: {
          user_id: string;
          results_seen_at: string | null;
          results_seen_prev: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["user_state"]["Row"]> & { user_id: string };
        Update: Partial<Database["public"]["Tables"]["user_state"]["Row"]>;
        Relationships: [];
      };
      favorites: {
        Row: {
          user_id: string;
          listing_id: string;
          created_at: string;
          note: string | null;
          last_notified_price: number | null;
          last_notified_gone_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["favorites"]["Row"]> & {
          user_id: string;
          listing_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["favorites"]["Row"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["push_subscriptions"]["Row"]> & {
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Row"]>;
        Relationships: [];
      };
      app_secrets: {
        Row: {
          key: string;
          value: string;
        };
        Insert: Database["public"]["Tables"]["app_secrets"]["Row"];
        Update: Partial<Database["public"]["Tables"]["app_secrets"]["Row"]>;
        Relationships: [];
      };
    };
    Views: {
      make_models: {
        Row: {
          make: string | null;
          model: string | null;
          listing_count: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      search_listings: {
        Args: {
          p_search_id?: string | null;
          p_make?: string | null;
          p_model?: string | null;
          p_price_from?: number | null;
          p_price_to?: number | null;
          p_year_from?: number | null;
          p_year_to?: number | null;
          p_mileage_max?: number | null;
          p_power_min_kw?: number | null;
          p_fuel?: string[] | null;
          p_body?: string[] | null;
          p_transmission?: string | null;
          p_sources?: string[] | null;
          p_drive?: string[] | null;
          p_text_terms?: string[] | null;
          p_only_new?: boolean | null;
          p_seen_prev?: string | null;
          p_sort?: string | null;
          p_limit?: number | null;
          p_offset?: number | null;
        };
        Returns: {
          id: string;
          source: string;
          source_id: string;
          url: string;
          title: string;
          make: string | null;
          model: string | null;
          variant: string | null;
          year: number | null;
          mileage_km: number | null;
          price_czk: number | null;
          price_orig: number | null;
          currency_orig: string;
          fuel: string | null;
          transmission: string | null;
          power_kw: number | null;
          body: string | null;
          color: string | null;
          location: string | null;
          country: string;
          seller_type: string;
          vin: string | null;
          image_urls: string[];
          drive: string | null;
          equipment: string[];
          first_seen: string;
          last_seen: string;
          is_active: boolean;
          fingerprint: string;
          group_id: string | null;
          created_at: string;
          match_id: string | null;
          match_status: string | null;
          group_offer_count: number;
          is_new: boolean;
          total_count: number;
        }[];
      };
      new_matches_count: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
    Enums: Record<string, never>;
  };
}
