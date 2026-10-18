use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        conn.execute_unprepared(
            "ALTER TABLE maxcode_todo_share ADD COLUMN codex_session_json TEXT",
        )
        .await?;
        conn.execute_unprepared("ALTER TABLE maxcode_todo_item ADD COLUMN codex_import_available INTEGER NOT NULL DEFAULT 0").await?;
        conn.execute_unprepared("CREATE TABLE maxcode_todo_codex_import (scope_id TEXT NOT NULL, todo_id TEXT NOT NULL, folder_id INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE, conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE, PRIMARY KEY(scope_id,todo_id,folder_id))").await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        conn.execute_unprepared("DROP TABLE maxcode_todo_codex_import")
            .await?;
        conn.execute_unprepared("ALTER TABLE maxcode_todo_item DROP COLUMN codex_import_available")
            .await?;
        conn.execute_unprepared("ALTER TABLE maxcode_todo_share DROP COLUMN codex_session_json")
            .await?;
        Ok(())
    }
}
