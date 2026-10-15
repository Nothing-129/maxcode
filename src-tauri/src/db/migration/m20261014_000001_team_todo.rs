use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // These tables intentionally have no dependency on the retired AI
        // work_task tables. Scope is either personal or a locally hosted team.
        for sql in [
            "CREATE TABLE maxcode_todo_preferences (id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL DEFAULT 'personal', active_team_id TEXT)",
            "INSERT INTO maxcode_todo_preferences (id) VALUES (1)",
            "CREATE TABLE maxcode_todo_team (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT, is_local INTEGER NOT NULL, self_id TEXT NOT NULL, member_token TEXT NOT NULL, invite_token TEXT, creation_operation_id TEXT UNIQUE)",
            "CREATE TABLE maxcode_todo_join_attempt (team_id TEXT NOT NULL, url TEXT NOT NULL, join_key TEXT NOT NULL, PRIMARY KEY(team_id, url))",
            "CREATE TABLE maxcode_todo_member (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL, token TEXT NOT NULL UNIQUE, join_key TEXT, UNIQUE(team_id, join_key))",
            "CREATE INDEX idx_maxcode_todo_member_team ON maxcode_todo_member (team_id)",
            "CREATE TABLE maxcode_todo_item (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('unclaimed', 'claimed', 'completed')), assignee_id TEXT, creator_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, source_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, operation_id TEXT, UNIQUE(scope_id, creator_id, operation_id))",
            "CREATE INDEX idx_maxcode_todo_item_scope ON maxcode_todo_item (scope_id, created_at)",
            "CREATE TABLE maxcode_todo_share (token TEXT PRIMARY KEY, todo_id TEXT NOT NULL UNIQUE, scope_id TEXT NOT NULL, snapshot_json TEXT NOT NULL)",
        ] {
            manager.get_connection().execute_unprepared(sql).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            "maxcode_todo_share",
            "maxcode_todo_item",
            "maxcode_todo_member",
            "maxcode_todo_team",
            "maxcode_todo_join_attempt",
            "maxcode_todo_preferences",
        ] {
            manager
                .get_connection()
                .execute_unprepared(&format!("DROP TABLE {table}"))
                .await?;
        }
        Ok(())
    }
}
