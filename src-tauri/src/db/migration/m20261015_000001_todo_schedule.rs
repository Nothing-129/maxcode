use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;
#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        conn.execute_unprepared("ALTER TABLE maxcode_todo_item ADD COLUMN due_date TEXT")
            .await?;
        conn.execute_unprepared("ALTER TABLE maxcode_todo_item ADD COLUMN priority TEXT")
            .await?;
        Ok(())
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        conn.execute_unprepared("ALTER TABLE maxcode_todo_item DROP COLUMN priority")
            .await?;
        conn.execute_unprepared("ALTER TABLE maxcode_todo_item DROP COLUMN due_date")
            .await?;
        Ok(())
    }
}
