use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use num_derive::{FromPrimitive, ToPrimitive};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod sai_citizenship {

    use super::*;

    pub fn initialize_swap(ctx: Context<InitializeSwap>, price: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.active = false;
        state.owner = ctx.accounts.owner.key();
        state.oni_vault = ctx.accounts.oni_vault.key();
        state.mud_vault = ctx.accounts.mud_vault.key();
        state.ustur_vault = ctx.accounts.ustur_vault.key();
        state.proceeds_vault = ctx.accounts.proceeds_vault.key();
        state.price = price;

        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, price: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.price = price;

        Ok(())
    }

    pub fn active_sell(ctx: Context<ActiveOrDeactiveSell>) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(!state.active, SaiCitizenshipError::AlreadyActivated);

        state.active = true;

        Ok(())
    }

    pub fn deactive_sell(ctx: Context<ActiveOrDeactiveSell>) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.active, SaiCitizenshipError::AlreadyDeactivated);

        state.active = false;

        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, faction: Faction) -> Result<()> {
        let state = &ctx.accounts.state;

        require!(state.active, SaiCitizenshipError::RequiredActiveState);

        msg!(
            "amount: {}, price: {}",
            ctx.accounts.buyer_out_token_account.amount,
            state.price
        );

        require!(
            ctx.accounts.buyer_out_token_account.amount >= state.price,
            SaiCitizenshipError::NotEnoughFunds
        );

        let vault_token_account = match faction {
            Faction::Oni => &ctx.accounts.oni_vault,
            Faction::Mud => &ctx.accounts.mud_vault,
            Faction::Ustur => &ctx.accounts.ustur_vault,
        };

        require!(
            vault_token_account.amount >= 1,
            SaiCitizenshipError::NotEnoughFundsInVault
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
            state.price,
        )?;

        let state_key = state.key();

        let (_, oni_nonce) = Pubkey::find_program_address(
            &[b"oni_vault".as_ref(), state_key.as_ref()],
            ctx.program_id,
        );

        let (_, mud_nonce) = Pubkey::find_program_address(
            &[b"mud_vault".as_ref(), state_key.as_ref()],
            ctx.program_id,
        );

        let (_, ustur_nonce) = Pubkey::find_program_address(
            &[b"ustur_vault".as_ref(), state_key.as_ref()],
            ctx.program_id,
        );

        let oni_seeds = [b"oni_vault".as_ref(), state_key.as_ref(), &[oni_nonce]];
        let mud_seeds = [b"mud_vault".as_ref(), state_key.as_ref(), &[mud_nonce]];
        let ustur_seeds = [b"ustur_vault".as_ref(), state_key.as_ref(), &[ustur_nonce]];

        let seeds = match faction {
            Faction::Oni => &oni_seeds,
            Faction::Mud => &mud_seeds,
            Faction::Ustur => &ustur_seeds,
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: vault_token_account.to_account_info(),
                    to: ctx.accounts.buyer_in_token_account.to_account_info(),
                    authority: vault_token_account.to_account_info(),
                },
                &[seeds],
            ),
            1,
        )?;

        Ok(())
    }

    pub fn withdraw_proceeds(ctx: Context<WithdrawProceeds>) -> Result<()> {
        require!(
            ctx.accounts.proceeds_vault.amount > 0,
            SaiCitizenshipError::NoProceedsToWithdraw
        );

        let state_key = ctx.accounts.state.key();

        let (_, nonce) = Pubkey::find_program_address(
            &[b"proceeds_vault".as_ref(), state_key.as_ref()],
            ctx.program_id,
        );

        let seeds = &[b"proceeds_vault".as_ref(), state_key.as_ref(), &[nonce]];

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
        space = 8 + 32 + 32 + 32 + 32 + 32 + 8 + 8
    )]
    pub state: Box<Account<'info, State>>,
    #[account(
        init,
        payer = owner,
        seeds = [b"oni_vault".as_ref(), state.key().as_ref()],
        bump,
        token::mint = oni_mint,
        token::authority = oni_vault
    )]
    pub oni_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = owner,
        seeds = [b"mud_vault".as_ref(), state.key().as_ref()],
        bump,
        token::mint = mud_mint,
        token::authority = mud_vault
    )]
    pub mud_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = owner,
        seeds = [b"ustur_vault".as_ref(), state.key().as_ref()],
        bump,
        token::mint = ustur_mint,
        token::authority = ustur_vault
    )]
    pub ustur_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = owner,
        seeds = [b"proceeds_vault".as_ref(), state.key().as_ref()],
        bump,
        token::mint = proceeds_mint,
        token::authority = proceeds_vault
    )]
    pub proceeds_vault: Box<Account<'info, TokenAccount>>,
    pub oni_mint: Account<'info, Mint>,
    pub mud_mint: Account<'info, Mint>,
    pub ustur_mint: Account<'info, Mint>,
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
    price: u64,
    mud_vault: Pubkey,
    oni_vault: Pubkey,
    owner: Pubkey,
    ustur_vault: Pubkey,
    proceeds_vault: Pubkey,
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
pub struct ActiveOrDeactiveSell<'info> {
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
        has_one = oni_vault,
        has_one = mud_vault,
        has_one = ustur_vault
    )]
    pub state: Box<Account<'info, State>>,
    #[account(mut)]
    pub proceeds_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub oni_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub mud_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub ustur_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer_out_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub buyer_in_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, FromPrimitive, ToPrimitive, Copy, Clone, PartialEq, Eq,
)]
pub enum Faction {
    Oni,
    Mud,
    Ustur,
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
    #[account(mut)]
    pub owner_in_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum SaiCitizenshipError {
    AlreadyActivated,
    AlreadyDeactivated,
    RequiredActiveState,
    NotEnoughFunds,
    NotEnoughFundsInVault,
    NoProceedsToWithdraw,
}
