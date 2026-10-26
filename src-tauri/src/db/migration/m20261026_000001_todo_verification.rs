use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::TransactionTrait;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        rebuild(manager, true).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        rebuild(manager, false).await
    }
}

async fn rebuild(manager: &SchemaManager<'_>, include_verification: bool) -> Result<(), DbErr> {
    let txn = manager.get_connection().begin().await?;
    // SQLite requires a rebuild to extend the status CHECK constraint.
    // No other table has a foreign key to this table; IDs stay unchanged.
    for sql in [
            "CREATE TABLE maxcode_todo_item_next (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('unclaimed', 'claimed', 'pending_verification', 'completed')), assignee_id TEXT, creator_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, source_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, operation_id TEXT, due_date TEXT, priority TEXT, completed_at TEXT, codex_import_available INTEGER NOT NULL DEFAULT 0, UNIQUE(scope_id, creator_id, operation_id))",
            "INSERT INTO maxcode_todo_item_next (id,scope_id,title,content,status,assignee_id,creator_id,revision,source_url,created_at,updated_at,operation_id,due_date,priority,completed_at,codex_import_available) SELECT id,scope_id,title,content,status,assignee_id,creator_id,revision,source_url,created_at,updated_at,operation_id,due_date,priority,completed_at,codex_import_available FROM maxcode_todo_item",
            "DROP TABLE maxcode_todo_item",
            "ALTER TABLE maxcode_todo_item_next RENAME TO maxcode_todo_item",
            "CREATE INDEX idx_maxcode_todo_item_scope ON maxcode_todo_item (scope_id, created_at)",
            "CREATE INDEX idx_maxcode_todo_item_completed ON maxcode_todo_item (scope_id, status, updated_at DESC, id DESC)",
        ] {
            // Downgrading with pending rows fails the old CHECK constraint and
            // rolls back atomically, rather than silently discarding their state.
            let sql = if include_verification {
                sql.to_owned()
            } else {
                sql.replace("'pending_verification', ", "")
            };
            txn.execute_unprepared(&sql).await?;
        }
    txn.commit().await?;
    Ok(())
}
