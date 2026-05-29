export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      autovacuum_settings: {
        Row: {
          captured_at: string
          database_id: string
          id: string
          schema_name: string | null
          scope: Database["public"]["Enums"]["autovacuum_scope"]
          settings: Json
          table_name: string | null
        }
        Insert: {
          captured_at?: string
          database_id: string
          id?: string
          schema_name?: string | null
          scope: Database["public"]["Enums"]["autovacuum_scope"]
          settings: Json
          table_name?: string | null
        }
        Update: {
          captured_at?: string
          database_id?: string
          id?: string
          schema_name?: string | null
          scope?: Database["public"]["Enums"]["autovacuum_scope"]
          settings?: Json
          table_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autovacuum_settings_database_id_fkey"
            columns: ["database_id"]
            isOneToOne: false
            referencedRelation: "monitored_databases"
            referencedColumns: ["id"]
          },
        ]
      }
      bloat_objects: {
        Row: {
          bloat_bytes: number
          bloat_pages: number | null
          captured_at: string
          database_id: string
          dead_tuple_estimate: number | null
          id: string
          kind: Database["public"]["Enums"]["bloat_object_kind"]
          metrics_id: string | null
          object_name: string
          parent_schema: string | null
          parent_table: string | null
          qualified_name: string | null
          relation_bytes: number
          schema_name: string
          meta: Json | null
        }
        Insert: {
          bloat_bytes: number
          bloat_pages?: number | null
          captured_at?: string
          database_id: string
          dead_tuple_estimate?: number | null
          id?: string
          kind: Database["public"]["Enums"]["bloat_object_kind"]
          metrics_id?: string | null
          object_name: string
          parent_schema?: string | null
          parent_table?: string | null
          qualified_name?: string | null
          relation_bytes: number
          meta?: Json | null
          schema_name: string
        }
        Update: {
          bloat_bytes?: number
          bloat_pages?: number | null
          captured_at?: string
          database_id?: string
          dead_tuple_estimate?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["bloat_object_kind"]
          metrics_id?: string | null
          object_name?: string
          parent_schema?: string | null
          parent_table?: string | null
          qualified_name?: string | null
          relation_bytes?: number
          schema_name?: string
          meta?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bloat_objects_database_id_fkey"
            columns: ["database_id"]
            isOneToOne: false
            referencedRelation: "monitored_databases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloat_objects_metrics_id_fkey"
            columns: ["metrics_id"]
            isOneToOne: false
            referencedRelation: "database_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      database_metrics: {
        Row: {
          captured_at: string
          database_id: string
          database_size_bytes: number
          id: string
          index_bloat_bytes: number
          index_bloat_estimated: boolean | null
          index_bloat_pages: number | null
          pgstattuple_installed: boolean | null
          reclaimable_bytes: number | null
          source: string
          table_bloat_bytes: number
          table_bloat_pages: number | null
        }
        Insert: {
          captured_at?: string
          database_id: string
          database_size_bytes: number
          id?: string
          index_bloat_bytes?: number
          index_bloat_estimated?: boolean | null
          index_bloat_pages?: number | null
          pgstattuple_installed?: boolean | null
          reclaimable_bytes?: number | null
          source?: string
          table_bloat_bytes?: number
          table_bloat_pages?: number | null
        }
        Update: {
          captured_at?: string
          database_id?: string
          database_size_bytes?: number
          id?: string
          index_bloat_bytes?: number
          index_bloat_estimated?: boolean | null
          index_bloat_pages?: number | null
          pgstattuple_installed?: boolean | null
          reclaimable_bytes?: number | null
          source?: string
          table_bloat_bytes?: number
          table_bloat_pages?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "database_metrics_database_id_fkey"
            columns: ["database_id"]
            isOneToOne: false
            referencedRelation: "monitored_databases"
            referencedColumns: ["id"]
          },
        ]
      }
      database_preferences: {
        Row: {
          database_id: string
          enforce_time_window: boolean
          exclude_patterns: string[]
          index_reindex_mode: Database["public"]["Enums"]["index_reindex_mode"]
          min_index_size_mb: number
          min_table_size_mb: number
          pause_between_ops_ms: number
          run_initial_check: boolean
          table_vacuum_mode: Database["public"]["Enums"]["table_vacuum_mode"]
          updated_at: string
        }
        Insert: {
          database_id: string
          enforce_time_window?: boolean
          exclude_patterns?: string[]
          index_reindex_mode?: Database["public"]["Enums"]["index_reindex_mode"]
          min_index_size_mb?: number
          min_table_size_mb?: number
          pause_between_ops_ms?: number
          run_initial_check?: boolean
          table_vacuum_mode?: Database["public"]["Enums"]["table_vacuum_mode"]
          updated_at?: string
        }
        Update: {
          database_id?: string
          enforce_time_window?: boolean
          exclude_patterns?: string[]
          index_reindex_mode?: Database["public"]["Enums"]["index_reindex_mode"]
          min_index_size_mb?: number
          min_table_size_mb?: number
          pause_between_ops_ms?: number
          run_initial_check?: boolean
          table_vacuum_mode?: Database["public"]["Enums"]["table_vacuum_mode"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "database_preferences_database_id_fkey"
            columns: ["database_id"]
            isOneToOne: true
            referencedRelation: "monitored_databases"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_jobs: {
        Row: {
          cleanup_rate_pages_per_sec: number | null
          created_at: string
          database_id: string
          error_message: string | null
          estimated_objects_completable: number | null
          estimated_pages_completable: number | null
          finished_at: string | null
          id: string
          kind: Database["public"]["Enums"]["job_run_kind"]
          objects_completed: number
          objects_queued: number
          pages_after: number | null
          pages_before: number | null
          pages_reclaimed: number | null
          schedule_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          window_ends_at: string
          window_started_at: string
        }
        Insert: {
          cleanup_rate_pages_per_sec?: number | null
          created_at?: string
          database_id: string
          error_message?: string | null
          estimated_objects_completable?: number | null
          estimated_pages_completable?: number | null
          finished_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["job_run_kind"]
          objects_completed?: number
          objects_queued?: number
          pages_after?: number | null
          pages_before?: number | null
          pages_reclaimed?: number | null
          schedule_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          window_ends_at: string
          window_started_at: string
        }
        Update: {
          cleanup_rate_pages_per_sec?: number | null
          created_at?: string
          database_id?: string
          error_message?: string | null
          estimated_objects_completable?: number | null
          estimated_pages_completable?: number | null
          finished_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["job_run_kind"]
          objects_completed?: number
          objects_queued?: number
          pages_after?: number | null
          pages_before?: number | null
          pages_reclaimed?: number | null
          schedule_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          window_ends_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_jobs_database_id_fkey"
            columns: ["database_id"]
            isOneToOne: false
            referencedRelation: "monitored_databases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_jobs_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "maintenance_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_operations: {
        Row: {
          bloat_bytes_after: number | null
          bloat_bytes_before: number | null
          bloat_pages_after: number | null
          bloat_pages_before: number | null
          cleanup_rate_pages_per_sec: number | null
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["bloat_object_kind"]
          object_name: string
          operation: string
          pages_reclaimed: number | null
          schema_name: string
          sort_order: number
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
        }
        Insert: {
          bloat_bytes_after?: number | null
          bloat_bytes_before?: number | null
          bloat_pages_after?: number | null
          bloat_pages_before?: number | null
          cleanup_rate_pages_per_sec?: number | null
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["bloat_object_kind"]
          object_name: string
          operation: string
          pages_reclaimed?: number | null
          schema_name: string
          sort_order?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
        }
        Update: {
          bloat_bytes_after?: number | null
          bloat_bytes_before?: number | null
          bloat_pages_after?: number | null
          bloat_pages_before?: number | null
          cleanup_rate_pages_per_sec?: number | null
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["bloat_object_kind"]
          object_name?: string
          operation?: string
          pages_reclaimed?: number | null
          schema_name?: string
          sort_order?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_operations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "maintenance_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_schedules: {
        Row: {
          bespoke_ends_at: string | null
          bespoke_starts_at: string | null
          created_at: string
          cron_expression: string | null
          database_id: string
          day_of_month: number | null
          day_of_week: number | null
          enabled: boolean
          id: string
          next_run_at: string | null
          recurrence: Database["public"]["Enums"]["schedule_recurrence"]
          timezone: string
          updated_at: string
          window_duration_minutes: number
          window_start_time: string
        }
        Insert: {
          bespoke_ends_at?: string | null
          bespoke_starts_at?: string | null
          created_at?: string
          cron_expression?: string | null
          database_id: string
          day_of_month?: number | null
          day_of_week?: number | null
          enabled?: boolean
          id?: string
          next_run_at?: string | null
          recurrence: Database["public"]["Enums"]["schedule_recurrence"]
          timezone?: string
          updated_at?: string
          window_duration_minutes?: number
          window_start_time?: string
        }
        Update: {
          bespoke_ends_at?: string | null
          bespoke_starts_at?: string | null
          created_at?: string
          cron_expression?: string | null
          database_id?: string
          day_of_month?: number | null
          day_of_week?: number | null
          enabled?: boolean
          id?: string
          next_run_at?: string | null
          recurrence?: Database["public"]["Enums"]["schedule_recurrence"]
          timezone?: string
          updated_at?: string
          window_duration_minutes?: number
          window_start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_schedules_database_id_fkey"
            columns: ["database_id"]
            isOneToOne: false
            referencedRelation: "monitored_databases"
            referencedColumns: ["id"]
          },
        ]
      }
      monitored_databases: {
        Row: {
          connection_vault_id: string
          maintenance_connection_vault_id: string | null
          created_at: string
          id: string
          index_bloat_estimated: boolean | null
          label: string
          last_health_at: string | null
          last_health_error: string | null
          last_health_ok: boolean | null
          paused: boolean
          pgstattuple_installed: boolean | null
          supabase_monitoring_role: string | null
          supabase_project_ref: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_vault_id: string
          maintenance_connection_vault_id?: string | null
          created_at?: string
          id?: string
          index_bloat_estimated?: boolean | null
          label: string
          last_health_at?: string | null
          last_health_error?: string | null
          last_health_ok?: boolean | null
          paused?: boolean
          pgstattuple_installed?: boolean | null
          supabase_monitoring_role?: string | null
          supabase_project_ref?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_vault_id?: string
          maintenance_connection_vault_id?: string | null
          created_at?: string
          id?: string
          index_bloat_estimated?: boolean | null
          label?: string
          last_health_at?: string | null
          last_health_error?: string | null
          last_health_ok?: boolean | null
          paused?: boolean
          pgstattuple_installed?: boolean | null
          supabase_monitoring_role?: string | null
          supabase_project_ref?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_supabase_accounts: {
        Row: {
          access_token_vault_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_vault_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_vault_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clear_supabase_access_token: { Args: never; Returns: undefined }
      delete_monitored_database: {
        Args: { p_database_id: string }
        Returns: undefined
      }
      get_user_supabase_access_token: { Args: never; Returns: string }
      queue_initial_check: { Args: { p_database_id: string }; Returns: string }
      queue_manual_maintenance: { Args: { p_database_id: string }; Returns: string }
      register_monitored_database:
        | {
            Args: {
              p_connection_string: string
              p_label: string
              p_preferences?: Json
            }
            Returns: Json
          }
        | {
            Args: {
              p_connection_string: string
              p_label: string
              p_preferences?: Json
              p_supabase_project_ref?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_connection_string: string
              p_label: string
              p_preferences?: Json
              p_supabase_monitoring_role?: string
              p_supabase_project_ref?: string
              p_schedules?: Json
            }
            Returns: Json
          }
        | {
            Args: {
              p_connection_string: string
              p_label: string
              p_preferences?: Json
              p_supabase_monitoring_role?: string
              p_supabase_project_ref?: string
              p_schedules?: Json
              p_maintenance_connection_string?: string
            }
            Returns: Json
          }
      save_database_maintenance_connection: {
        Args: { p_connection_string: string; p_database_id: string }
        Returns: undefined
      }
      save_supabase_access_token: {
        Args: { p_access_token: string }
        Returns: undefined
      }
    }
    Enums: {
      autovacuum_scope: "global" | "table" | "index_maintenance"
      bloat_object_kind: "table" | "index" | "invalid_index" | "unused_index"
      index_reindex_mode: "reindex" | "reindex_concurrently"
      job_run_kind: "scheduled" | "initial" | "manual"
      job_status:
        | "pending"
        | "running"
        | "completed"
        | "partial"
        | "failed"
        | "cancelled"
      schedule_recurrence: "daily" | "weekly" | "monthly" | "bespoke"
      table_vacuum_mode: "vacuum" | "vacuum_analyze"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      autovacuum_scope: ["global", "table", "index_maintenance"],
      bloat_object_kind: ["table", "index", "invalid_index", "unused_index"],
      index_reindex_mode: ["reindex", "reindex_concurrently"],
      job_run_kind: ["scheduled", "initial", "manual"],
      job_status: [
        "pending",
        "running",
        "completed",
        "partial",
        "failed",
        "cancelled",
      ],
      schedule_recurrence: ["daily", "weekly", "monthly", "bespoke"],
      table_vacuum_mode: ["vacuum", "vacuum_analyze"],
    },
  },
} as const

