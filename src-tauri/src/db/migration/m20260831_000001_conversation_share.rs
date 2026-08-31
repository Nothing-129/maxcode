use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ConversationShare::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ConversationShare::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ConversationShare::ConversationId)
                            .integer()
                            .not_null(),
                    )
                    // The token is the only credential for the public,
                    // read-only endpoint. UUID v4 without separators gives
                    // 122 bits of entropy while remaining URL-fragment safe.
                    .col(ColumnDef::new(ConversationShare::Token).string().not_null())
                    // Immutable-at-read snapshot: a shared link never grants
                    // live access to the underlying transcript files.
                    .col(
                        ColumnDef::new(ConversationShare::SnapshotJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationShare::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationShare::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationShare::RevokedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_conversation_share_conversation")
                            .from(ConversationShare::Table, ConversationShare::ConversationId)
                            .to(Conversation::Table, Conversation::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_conversation_share_conversation")
                    .table(ConversationShare::Table)
                    .col(ConversationShare::ConversationId)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_conversation_share_token")
                    .table(ConversationShare::Table)
                    .col(ConversationShare::Token)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ConversationShare::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ConversationShare {
    Table,
    Id,
    ConversationId,
    Token,
    SnapshotJson,
    CreatedAt,
    UpdatedAt,
    RevokedAt,
}

#[derive(DeriveIden)]
enum Conversation {
    Table,
    Id,
}
