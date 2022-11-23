import * as anchor from "@project-serum/anchor";
import { AnchorError, Program } from "@project-serum/anchor";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { expect } from "chai";
import { createVaultPdas } from "../migrations/createVaultPdas";
import { SaiTokenSwap } from "../target/types/sai_token_swap";
import { airdrop } from "./airdrop";
import { createTokenMint } from "./createMint";
import { setupBuyerAccounts } from "./setupBuyerAccounts";

export const setupSwap = async (
  program: anchor.Program<SaiTokenSwap>,
  owner: anchor.web3.Keypair,
  price: number,
  returnPrice: number
) => {
  const programProvider = program.provider as anchor.AnchorProvider;

  const mintOwner = anchor.web3.Keypair.generate();

  await airdrop(program, mintOwner.publicKey);
  await airdrop(program, owner.publicKey);

  const usdcMint = await createTokenMint(
    programProvider.connection,
    mintOwner,
    6
  );

  const tokenMint = await createTokenMint(
    programProvider.connection,
    mintOwner,
    0
  );

  const stateAccount = anchor.web3.Keypair.generate();

  const { vaultPda, proceedsVaultPda } = await createVaultPdas(
    program,
    stateAccount.publicKey
  );

  await program.methods
    .initializeSwap(new BN(price), new BN(returnPrice))
    .accounts({
      state: stateAccount.publicKey,
      vault: vaultPda,
      proceedsVault: proceedsVaultPda,
      mint: tokenMint,
      proceedsMint: usdcMint,
      owner: owner.publicKey,
    })
    .signers([stateAccount, owner])
    .rpc();

  await mintTo(
    programProvider.connection,
    mintOwner,
    tokenMint,
    vaultPda,
    mintOwner.publicKey,
    100
  );

  return {
    mintOwner,
    tokenMint,
    vaultPda,
    proceedsVaultPda,
    stateAccount,
    usdcMint,
  };
};

const setupAndArm = async (
  program: anchor.Program<SaiCitizenship>,
  owner: anchor.web3.Keypair,
  price: number,
  returnPrice: number
) => {
  const { stateAccount, ...rest } = await setupSwap(
    program,
    owner,
    price,
    returnPrice
  );

  await program.methods
    .startSale()
    .accounts({
      state: stateAccount.publicKey,
      owner: owner.publicKey,
    })
    .signers([owner])
    .rpc();

  return { stateAccount, ...rest };
};

describe("sai-token-swap", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SaiTokenSwap as Program<SaiTokenSwap>;

  it("initialized a swap state account", async () => {
    const owner = anchor.web3.Keypair.generate();
    const price = 15 * Math.pow(10, 6);
    const returnPrice = 1;

    const { stateAccount } = await setupSwap(
      program,
      owner,
      price,
      returnPrice
    );

    const state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.active).eq(false);
    expect(state.owner.toString()).eq(owner.publicKey.toString());
    expect(state.priceProceedsMint.toNumber()).eq(price);
    expect(state.priceVaultMint.toNumber()).eq(returnPrice);
  });

  it("updates the swap price", async () => {
    const owner = anchor.web3.Keypair.generate();
    const price = 15 * Math.pow(10, 6);
    const returnPrice = 1;

    const { stateAccount } = await setupSwap(
      program,
      owner,
      price,
      returnPrice
    );

    let state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.priceProceedsMint.toNumber()).eq(price);

    const newPrice = 20 * Math.pow(10, 6);
    const newReturnPrice = 2;

    await program.methods
      .updatePrices(new BN(newPrice), new BN(newReturnPrice))
      .accounts({
        state: stateAccount.publicKey,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.priceProceedsMint.toNumber()).eq(newPrice);
    expect(state.priceVaultMint.toNumber()).eq(newReturnPrice);
  });

  it("activates after active_sell is called", async () => {
    const owner = anchor.web3.Keypair.generate();
    const price = 15;
    const returnPrice = 1;

    const { stateAccount } = await setupSwap(
      program,
      owner,
      price * Math.pow(10, 6),
      returnPrice
    );

    let state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.active).eq(false);

    await program.methods
      .startSale()
      .accounts({
        state: stateAccount.publicKey,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.active).eq(true);
  });

  it("throws an error if deactivation is called and active is false", async () => {
    const owner = anchor.web3.Keypair.generate();
    const price = 15;
    const returnPrice = 1;

    const { stateAccount } = await setupSwap(
      program,
      owner,
      price * Math.pow(10, 6),
      returnPrice
    );

    let state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.active).eq(false);

    try {
      await program.methods
        .stopSale()
        .accounts({
          state: stateAccount.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).eq("AlreadyStopped");
    }
  });

  it("swaps N usdc for 1 token", async () => {
    const owner = anchor.web3.Keypair.generate();

    const price = 15;
    const returnPrice = 1;

    const {
      stateAccount,
      vaultPda,
      tokenMint,
      proceedsVaultPda,
      usdcMint,
      mintOwner,
    } = await setupAndArm(program, owner, price * Math.pow(10, 6), returnPrice);
    const buyer = anchor.web3.Keypair.generate();

    const { buyerUsdcTokenAccount, buyerOtherTokenAccount } =
      await setupBuyerAccounts(program, buyer, mintOwner, usdcMint, tokenMint);

    const programProvider = program.provider as anchor.AnchorProvider;

    await mintTo(
      programProvider.connection,
      mintOwner,
      usdcMint,
      buyerUsdcTokenAccount.address,
      mintOwner.publicKey,
      1000 * Math.pow(10, 6)
    );

    await program.methods
      .swap()
      .accounts({
        mint: tokenMint,
        buyerInTokenAccount: buyerOtherTokenAccount.address,
        buyerOutTokenAccount: buyerUsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer.publicKey,
        vault: vaultPda,
        proceedsVault: proceedsVaultPda,
      })
      .signers([buyer])
      .rpc();

    const usdcBalance = await programProvider.connection.getTokenAccountBalance(
      buyerUsdcTokenAccount.address
    );

    const otherTokenBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyerOtherTokenAccount.address
      );

    const proceedsVaultBalance =
      await programProvider.connection.getTokenAccountBalance(proceedsVaultPda);

    expect(otherTokenBalance.value.uiAmount).eq(1);
    expect(usdcBalance.value.uiAmount).eq(1000 - price);
    expect(proceedsVaultBalance.value.uiAmount).eq(price);
  });

  it("withdraw all the proceeds", async () => {
    const owner = anchor.web3.Keypair.generate();

    const price = 15;
    const returnPrice = 1;

    const {
      stateAccount,
      vaultPda,
      proceedsVaultPda,
      tokenMint,
      usdcMint,
      mintOwner,
    } = await setupAndArm(program, owner, price * Math.pow(10, 6), returnPrice);

    const buyer = anchor.web3.Keypair.generate();
    const buyer2 = anchor.web3.Keypair.generate();

    const { buyerUsdcTokenAccount, buyerOtherTokenAccount: buyerTokenAccount } =
      await setupBuyerAccounts(program, buyer, mintOwner, usdcMint, tokenMint);

    const {
      buyerUsdcTokenAccount: buyer2UsdcTokenAccount,
      buyerOtherTokenAccount: buyer2TokenAccount,
    } = await setupBuyerAccounts(
      program,
      buyer2,
      mintOwner,
      usdcMint,
      tokenMint
    );

    const programProvider = program.provider as anchor.AnchorProvider;

    await mintTo(
      programProvider.connection,
      mintOwner,
      usdcMint,
      buyerUsdcTokenAccount.address,
      mintOwner.publicKey,
      1000 * Math.pow(10, 6)
    );

    await mintTo(
      programProvider.connection,
      mintOwner,
      usdcMint,
      buyer2UsdcTokenAccount.address,
      mintOwner.publicKey,
      1000 * Math.pow(10, 6)
    );

    await program.methods
      .swap()
      .accounts({
        buyerInTokenAccount: buyerTokenAccount.address,
        buyerOutTokenAccount: buyerUsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer.publicKey,
        vault: vaultPda,
        proceedsVault: proceedsVaultPda,
        mint: tokenMint,
      })
      .signers([buyer])
      .rpc();

    await program.methods
      .swap()
      .accounts({
        buyerInTokenAccount: buyer2TokenAccount.address,
        buyerOutTokenAccount: buyer2UsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer2.publicKey,
        vault: vaultPda,
        proceedsVault: proceedsVaultPda,
        mint: tokenMint,
      })
      .signers([buyer2])
      .rpc();

    const buyerUsdcBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyerUsdcTokenAccount.address
      );

    const buyer2UsdcBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyer2UsdcTokenAccount.address
      );

    const buyerTokenBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyerTokenAccount.address
      );

    const buyer2TokenBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyer2TokenAccount.address
      );

    let proceedsVaultBalance =
      await programProvider.connection.getTokenAccountBalance(proceedsVaultPda);

    expect(buyerTokenBalance.value.uiAmount).eq(1);
    expect(buyer2TokenBalance.value.uiAmount).eq(1);
    expect(buyerUsdcBalance.value.uiAmount).eq(1000 - price);
    expect(buyer2UsdcBalance.value.uiAmount).eq(1000 - price);
    expect(proceedsVaultBalance.value.uiAmount).eq(price * 2);

    const proceedsTokenAccountAddress = await getAssociatedTokenAddress(
      usdcMint,
      owner.publicKey
    );

    await program.methods
      .withdrawProceeds()
      .accounts({
        state: stateAccount.publicKey,
        proceedsVault: proceedsVaultPda,
        ownerInTokenAccount: proceedsTokenAccountAddress,
        owner: owner.publicKey,
        mint: usdcMint,
      })
      .signers([owner])
      .rpc();

    proceedsVaultBalance =
      await programProvider.connection.getTokenAccountBalance(proceedsVaultPda);

    const ownerProceedsBalance =
      await programProvider.connection.getTokenAccountBalance(
        proceedsTokenAccountAddress
      );

    expect(proceedsVaultBalance.value.uiAmount).eq(0);
    expect(ownerProceedsBalance.value.uiAmount).eq(price * 2);
  });

  it("explode if delinquent tries to withdraw", async () => {
    const owner = anchor.web3.Keypair.generate();
    const delinquent = anchor.web3.Keypair.generate();

    const price = 15;
    const returnPrice = 15;

    const {
      stateAccount,
      vaultPda,
      proceedsVaultPda,
      tokenMint,
      usdcMint,
      mintOwner,
    } = await setupAndArm(program, owner, price * Math.pow(10, 6), returnPrice);
    const buyer = anchor.web3.Keypair.generate();

    const { buyerUsdcTokenAccount, buyerOtherTokenAccount } =
      await setupBuyerAccounts(program, buyer, mintOwner, usdcMint, tokenMint);

    const programProvider = program.provider as anchor.AnchorProvider;

    await mintTo(
      programProvider.connection,
      mintOwner,
      usdcMint,
      buyerUsdcTokenAccount.address,
      mintOwner.publicKey,
      1000 * Math.pow(10, 6)
    );

    await program.methods
      .swap()
      .accounts({
        buyerInTokenAccount: buyerOtherTokenAccount.address,
        buyerOutTokenAccount: buyerUsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer.publicKey,
        vault: vaultPda,
        proceedsVault: proceedsVaultPda,
        mint: tokenMint,
      })
      .signers([buyer])
      .rpc();

    const proceedsTokenAccount = await getOrCreateAssociatedTokenAccount(
      programProvider.connection,
      mintOwner,
      usdcMint,
      delinquent.publicKey
    );

    try {
      await program.methods
        .withdrawProceeds()
        .accounts({
          state: stateAccount.publicKey,
          proceedsVault: proceedsVaultPda,
          ownerInTokenAccount: proceedsTokenAccount.address,
          owner: delinquent.publicKey,
          mint: usdcMint,
        })
        .signers([delinquent])
        .rpc();
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).eq("ConstraintHasOne");
    }
  });
});
