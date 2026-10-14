use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "automation_message")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub automation_id: i32,
    pub source_key: String,
    pub message_key: String,
    #[sea_orm(column_type = "Text")]
    pub payload: String,
    pub received_at: DateTimeUtc,
    pub run_id: Option<i32>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
