use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        conn.execute_unprepared(
            "CREATE TABLE maxcode_todo_conversation_link (scope_id TEXT NOT NULL, todo_id TEXT NOT NULL, conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(scope_id, todo_id, conversation_id))",
        )
        .await?;
        conn.execute_unprepared(
            "CREATE INDEX idx_maxcode_todo_conversation_link_conversation ON maxcode_todo_conversation_link (conversation_id)",
        )
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP TABLE maxcode_todo_conversation_link")
            .await?;
        Ok(())
    }
}
