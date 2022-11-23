use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("DCcmLPojwSQN72iuRJmER1NGmnnoFbfZyG1k7nQpEdXA");

#[program]
pub mod sai_token_swap {

    use super::*;

    pub fn initialize_swap(
        ctx: Context<InitializeSwap>,
        price_proceeds_mint: u64,
        price_vault_mint: u64,
    ) -> Result<()> {
        require!(
            price_proceeds_mint > 0 && price_vault_mint > 0,
            SaiCitizenshipError::InvalidPrice
        );

        let state = &mut ctx.accounts.state;
        state.active = false;
        state.owner = ctx.accounts.owner.key();
        state.vault = ctx.accounts.vault.key();

        state.vault_bump = *ctx
            .bumps
            .get("vault")
            .ok_or_else(|| error!(SaiCitizenshipError::BumpSeedNotInHashMap))?;

        state.proceeds_bump = *ctx
            .bumps
            .get("proceeds_vault")
            .ok_or_else(|| error!(SaiCitizenshipError::BumpSeedNotInHashMap))?;

        state.proceeds_vault = ctx.accounts.proceeds_vault.key();
        state.price_proceeds_mint = price_proceeds_mint;
        state.price_vault_mint = price_vault_mint;

        Ok(())
    }

    pub fn update_prices(
        ctx: Context<UpdatePrice>,
        price_proceeds_mint: u64,
        price_vault_mint: u64,
    ) -> Result<()> {
        require!(
            price_proceeds_mint > 0 && price_vault_mint > 0,
            SaiCitizenshipError::InvalidPrice
        );

        let state = &mut ctx.accounts.state;
        state.price_proceeds_mint = price_proceeds_mint;
        state.price_vault_mint = price_vault_mint;

        Ok(())
    }

    pub fn start_sale(ctx: Context<UpdateSale>) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(!state.active, SaiCitizenshipError::AlreadyStarted);

        state.active = true;

        Ok(())
    }

    pub fn stop_sale(ctx: Context<UpdateSale>) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.active, SaiCitizenshipError::AlreadyStopped);

        state.active = false;

        Ok(())
    }

    pub fn swap(ctx: Context<Swap>) -> Result<()> {
        let state = &ctx.accounts.state;

        require!(state.active, SaiCitizenshipError::SaleNotStarted);

        require_keys_eq!(
            ctx.accounts.buyer_in_token_account.mint,
            ctx.accounts.mint.key(),
            SaiCitizenshipError::InvalidSwapDestination
        );

        require!(
            ctx.accounts.buyer_out_token_account.amount >= state.price_proceeds_mint,
            SaiCitizenshipError::NotEnoughFunds
        );

        require!(
            ctx.accounts.vault.amount >= 1,
            SaiCitizenshipError::InsolventVault
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_out_token_account.to_account_info(),
                    to: ctx.accounts.proceeds_vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            state.price_proceeds_mint,
        )?;

        let state_key = state.key();

        let seeds = &[b"vault".as_ref(), state_key.as_ref(), &[state.vault_bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer_in_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            state.price_vault_mint,
        )?;

        Ok(())
    }

    pub fn withdraw_proceeds(ctx: Context<WithdrawProceeds>) -> Result<()> {
        require!(
            ctx.accounts.proceeds_vault.amount > 0,
            SaiCitizenshipError::InsolventProceedsVault
        );

        require_keys_eq!(
            ctx.accounts.proceeds_vault.mint,
            ctx.accounts.mint.key(),
            SaiCitizenshipError::InvalidWithdrawDestination
        );

        let state = &ctx.accounts.state;
        let state_key = state.key();

        let seeds = &[
            b"proceeds_vault".as_ref(),
            state_key.as_ref(),
            &[state.proceeds_bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.proceeds_vault.to_account_info(),
                    to: ctx.accounts.owner_in_token_account.to_account_info(),
                    authority: ctx.accounts.proceeds_vault.to_account_info(),
                },
                &[seeds],
            ),
            ctx.accounts.proceeds_vault.amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeSwap<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8
    )]
    pub state: Box<Account<'info, State>>,
    #[account(
        init,
        payer = owner,
        seeds = [b"vault".as_ref(), state.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        seeds = [b"proceeds_vault".as_ref(), state.key().as_ref()],
        bump,
        token::mint = proceeds_mint,
        token::authority = proceeds_vault
    )]
    pub proceeds_vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub proceeds_mint: Account<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct State {
    active: bool,
    price_proceeds_mint: u64,
    price_vault_mint: u64,
    vault: Pubkey,
    vault_bump: u8,
    owner: Pubkey,
    proceeds_vault: Pubkey,
    proceeds_bump: u8,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(mut, has_one = owner)]
    pub state: Account<'info, State>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSale<'info> {
    #[account(mut, has_one = owner)]
    pub state: Account<'info, State>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        mut,
        has_one = proceeds_vault,
        has_one = vault,
    )]
    pub state: Box<Account<'info, State>>,
    #[account(
        mut,
        seeds = [b"proceeds_vault".as_ref(), state.key().as_ref()],
        bump = state.proceeds_bump,
    )]
    pub proceeds_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [b"vault".as_ref(), state.key().as_ref()],
        bump = state.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = buyer_out_token_account.owner == buyer.key()
    )]
    pub buyer_out_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_in_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    // system required
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct WithdrawProceeds<'info> {
    #[account(
        mut,
        has_one= owner,
        has_one = proceeds_vault,
    )]
    pub state: Box<Account<'info, State>>,
    #[account(mut)]
    pub proceeds_vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = owner
    )]
    pub owner_in_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[error_code]
pub enum SaiCitizenshipError {
    AlreadyStarted,
    AlreadyStopped,
    BumpSeedNotInHashMap,
    InsolventProceedsVault,
    InsolventVault,
    InvalidPrice,
    InvalidSwapDestination,
    InvalidWithdrawDestination,
    NotEnoughFunds,
    SaleNotStarted,
}