use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;
#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(
            "CREATE TABLE maxcode_todo_attachment (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL)"
        ).await?;
        manager
            .get_connection()
            .execute_unprepared(
                "CREATE INDEX idx_todo_attachment_scope ON maxcode_todo_attachment(scope_id)",
            )
            .await?;
        Ok(())
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP TABLE maxcode_todo_attachment")
            .await?;
        Ok(())
    }
}
