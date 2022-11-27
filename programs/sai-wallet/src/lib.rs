use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod sai_wallet {

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // let owner = ctx.accounts.owner.to_account_info()

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
