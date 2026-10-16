use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // This reserved marker starts the former Base64 attachment tail.
        // Work in SQL so large historical payloads are not loaded into memory.
        // Keep attachment-only todos (with an empty body), and bump revisions
        // so an editor opened before the migration cannot overwrite the cleanup.
        manager.get_connection().execute_unprepared(
            "UPDATE maxcode_todo_item
             SET content = rtrim(substr(content, 1, instr(content, '<!-- maxcode-todo-attachments:v1 -->') - 1), char(10) || char(13) || ' '),
                 revision = revision + 1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE instr(content, '<!-- maxcode-todo-attachments:v1 -->') > 0"
        ).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Intentionally irreversible: deleted file bytes cannot be restored.
        Ok(())
    }
}
