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
          first_seen: string;
          last_seen: string;
          is_active: boolean;
          fingerprint: string;
          group_id: string | null;
          created_at: string;
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
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
