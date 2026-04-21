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
      profiles: {
        Row: {
          created_at: string
          default_level: Database["public"]["Enums"]["cefr_level"]
          default_stretch: boolean
          display_name: string | null
          gemini_api_key: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_level?: Database["public"]["Enums"]["cefr_level"]
          default_stretch?: boolean
          display_name?: string | null
          gemini_api_key?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_level?: Database["public"]["Enums"]["cefr_level"]
          default_stretch?: boolean
          display_name?: string | null
          gemini_api_key?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      srs_reviews: {
        Row: {
          created_at: string
          due_at: string
          ease: number
          id: string
          interval_days: number
          lapses: number
          last_reviewed_at: string | null
          reps: number
          user_id: string
          vocab_id: string
        }
        Insert: {
          created_at?: string
          due_at?: string
          ease?: number
          id?: string
          interval_days?: number
          lapses?: number
          last_reviewed_at?: string | null
          reps?: number
          user_id: string
          vocab_id: string
        }
        Update: {
          created_at?: string
          due_at?: string
          ease?: number
          id?: string
          interval_days?: number
          lapses?: number
          last_reviewed_at?: string | null
          reps?: number
          user_id?: string
          vocab_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "srs_reviews_vocab_id_fkey"
            columns: ["vocab_id"]
            isOneToOne: true
            referencedRelation: "vocab_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stories: {
        Row: {
          body: string
          created_at: string
          format: Database["public"]["Enums"]["story_format"]
          id: string
          level: Database["public"]["Enums"]["cefr_level"]
          mode: Database["public"]["Enums"]["story_mode"]
          parent_story_id: string | null
          stretch_level: Database["public"]["Enums"]["cefr_level"] | null
          summary: string | null
          title: string
          topic: string | null
          updated_at: string
          user_id: string
          word_count: number | null
        }
        Insert: {
          body: string
          created_at?: string
          format?: Database["public"]["Enums"]["story_format"]
          id?: string
          level: Database["public"]["Enums"]["cefr_level"]
          mode?: Database["public"]["Enums"]["story_mode"]
          parent_story_id?: string | null
          stretch_level?: Database["public"]["Enums"]["cefr_level"] | null
          summary?: string | null
          title: string
          topic?: string | null
          updated_at?: string
          user_id: string
          word_count?: number | null
        }
        Update: {
          body?: string
          created_at?: string
          format?: Database["public"]["Enums"]["story_format"]
          id?: string
          level?: Database["public"]["Enums"]["cefr_level"]
          mode?: Database["public"]["Enums"]["story_mode"]
          parent_story_id?: string | null
          stretch_level?: Database["public"]["Enums"]["cefr_level"] | null
          summary?: string | null
          title?: string
          topic?: string | null
          updated_at?: string
          user_id?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stories_parent_story_id_fkey"
            columns: ["parent_story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      story_annotations: {
        Row: {
          created_at: string
          grammar: Json
          id: string
          story_id: string
          tokens: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          grammar?: Json
          id?: string
          story_id: string
          tokens?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          grammar?: Json
          id?: string
          story_id?: string
          tokens?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_annotations_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: true
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vocab_items: {
        Row: {
          created_at: string
          first_seen_sentence: string | null
          first_story_id: string | null
          id: string
          lemma: string
          notes: string | null
          pos: string | null
          translation: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          first_seen_sentence?: string | null
          first_story_id?: string | null
          id?: string
          lemma: string
          notes?: string | null
          pos?: string | null
          translation?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          first_seen_sentence?: string | null
          first_story_id?: string | null
          id?: string
          lemma?: string
          notes?: string | null
          pos?: string | null
          translation?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocab_items_first_story_id_fkey"
            columns: ["first_story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      cefr_level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2"
      story_format: "news" | "short_story" | "novel_chapter" | "dialogue"
      story_mode: "standard" | "stretch"
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
    Enums: {
      app_role: ["admin", "user"],
      cefr_level: ["A1", "A2", "B1", "B2", "C1", "C2"],
      story_format: ["news", "short_story", "novel_chapter", "dialogue"],
      story_mode: ["standard", "stretch"],
    },
  },
} as const
