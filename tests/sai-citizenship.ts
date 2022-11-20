import * as anchor from "@project-serum/anchor";
import { AnchorError, Program } from "@project-serum/anchor";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { BN } from "bn.js";
import { expect } from "chai";
import { SaiCitizenship } from "../target/types/sai_citizenship";
import { airdrop } from "./airdrop";
import { createTokenMint } from "./createMint";
import { createVaultPdas } from "./createVaultPdas/index.ts";
import { setupBuyerAccounts } from "./setupBuyerAccounts";

const setupSwap = async (
  program: anchor.Program<SaiCitizenship>,
  owner: anchor.web3.Keypair,
  price: number
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

  const oniMint = await createTokenMint(
    programProvider.connection,
    mintOwner,
    0
  );

  const mudMint = await createTokenMint(
    programProvider.connection,
    mintOwner,
    0
  );

  const usturMint = await createTokenMint(
    programProvider.connection,
    mintOwner,
    0
  );

  const stateAccount = anchor.web3.Keypair.generate();

  const { oniVaultPda, mudVaultPda, usturVaultPda, proceedsVaultPda } =
    await createVaultPdas(program, stateAccount.publicKey);

  await program.methods
    .initializeSwap(new BN(price))
    .accounts({
      state: stateAccount.publicKey,
      oniVault: oniVaultPda,
      mudVault: mudVaultPda,
      usturVault: usturVaultPda,
      proceedsVault: proceedsVaultPda,
      oniMint,
      mudMint,
      usturMint,
      proceedsMint: usdcMint,
      owner: owner.publicKey,
    })
    .signers([stateAccount, owner])
    .rpc();

  await Promise.all([
    mintTo(
      programProvider.connection,
      mintOwner,
      oniMint,
      oniVaultPda,
      mintOwner.publicKey,
      100
    ),
    mintTo(
      programProvider.connection,
      mintOwner,
      mudMint,
      mudVaultPda,
      mintOwner.publicKey,
      100
    ),
    mintTo(
      programProvider.connection,
      mintOwner,
      usturMint,
      usturVaultPda,
      mintOwner.publicKey,
      100
    ),
  ]);

  return {
    mintOwner,
    mudMint,
    mudVaultPda,
    oniMint,
    oniVaultPda,
    proceedsVaultPda,
    stateAccount,
    usdcMint,
    usturMint,
    usturVaultPda,
  };
};

const setupAndArm = async (
  program: anchor.Program<SaiCitizenship>,
  owner: anchor.web3.Keypair,
  price: number
) => {
  const { stateAccount, ...rest } = await setupSwap(program, owner, price);

  await program.methods
    .activeSell()
    .accounts({
      state: stateAccount.publicKey,
      owner: owner.publicKey,
    })
    .signers([owner])
    .rpc();

  return { stateAccount, ...rest };
};

describe("sai-citizenship", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SaiCitizenship as Program<SaiCitizenship>;

  it("initialized a swap state account", async () => {
    const owner = anchor.web3.Keypair.generate();
    const price = 15 * Math.pow(10, 6);

    const { stateAccount } = await setupSwap(program, owner, price);

    const state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.active).eq(false);
    expect(state.owner.toString()).eq(owner.publicKey.toString());
    expect(state.price.toNumber()).eq(price);
  });

  it("updates the swap price", async () => {
    const owner = anchor.web3.Keypair.generate();
    const price = 15 * Math.pow(10, 6);

    const { stateAccount } = await setupSwap(program, owner, price);

    let state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.price.toNumber()).eq(price);

    const newPrice = 20 * Math.pow(10, 6);

    await program.methods
      .updatePrice(new BN(newPrice))
      .accounts({
        state: stateAccount.publicKey,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.price.toNumber()).eq(newPrice);
  });

  it("activates after active_sell is called", async () => {
    const owner = anchor.web3.Keypair.generate();
    const price = 15;

    const { stateAccount } = await setupSwap(
      program,
      owner,
      price * Math.pow(10, 6)
    );

    let state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.active).eq(false);

    await program.methods
      .activeSell()
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

    const { stateAccount } = await setupSwap(
      program,
      owner,
      price * Math.pow(10, 6)
    );

    let state = await program.account.state.fetch(stateAccount.publicKey);

    expect(state.active).eq(false);

    try {
      await program.methods
        .deactiveSell()
        .accounts({
          state: stateAccount.publicKey,
          owner: owner.publicKey,
        })
        .signers([owner])
        .rpc();
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).eq("AlreadyDeactivated");
    }
  });

  it("swaps N usdc for 1 token", async () => {
    const owner = anchor.web3.Keypair.generate();

    const price = 15;

    const faction = { oni: {} };

    const {
      stateAccount,
      oniVaultPda,
      mudVaultPda,
      usturVaultPda,
      proceedsVaultPda,
      oniMint,
      usdcMint,
      mintOwner,
    } = await setupAndArm(program, owner, price * Math.pow(10, 6));
    const buyer = anchor.web3.Keypair.generate();

    const {
      buyerUsdcTokenAccount,
      buyerOtherTokenAccount: buyerOniTokenAccount,
    } = await setupBuyerAccounts(program, buyer, mintOwner, usdcMint, oniMint);

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
      .swap(faction)
      .accounts({
        buyerInTokenAccount: buyerOniTokenAccount.address,
        buyerOutTokenAccount: buyerUsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer.publicKey,
        oniVault: oniVaultPda,
        mudVault: mudVaultPda,
        usturVault: usturVaultPda,
        proceedsVault: proceedsVaultPda,
      })
      .signers([buyer])
      .rpc();

    const usdcBalance = await programProvider.connection.getTokenAccountBalance(
      buyerUsdcTokenAccount.address
    );

    const oniTokenBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyerOniTokenAccount.address
      );

    const proceedsVaultBalance =
      await programProvider.connection.getTokenAccountBalance(proceedsVaultPda);

    expect(oniTokenBalance.value.uiAmount).eq(1);
    expect(usdcBalance.value.uiAmount).eq(1000 - price);
    expect(proceedsVaultBalance.value.uiAmount).eq(price);
  });

  it("withdraw all the proceeds", async () => {
    const owner = anchor.web3.Keypair.generate();

    const price = 15;

    const {
      stateAccount,
      oniVaultPda,
      mudVaultPda,
      usturVaultPda,
      proceedsVaultPda,
      oniMint,
      usdcMint,
      mintOwner,
      mudMint,
      usturMint,
    } = await setupAndArm(program, owner, price * Math.pow(10, 6));

    const buyer = anchor.web3.Keypair.generate();

    const {
      buyerUsdcTokenAccount,
      buyerOtherTokenAccount: buyerOniTokenAccount,
    } = await setupBuyerAccounts(program, buyer, mintOwner, usdcMint, oniMint);

    const { buyerOtherTokenAccount: buyerMudTokenAccount } =
      await setupBuyerAccounts(program, buyer, mintOwner, usdcMint, mudMint);

    const { buyerOtherTokenAccount: buyerUsturTokenAccount } =
      await setupBuyerAccounts(program, buyer, mintOwner, usdcMint, usturMint);

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
      .swap({ oni: {} })
      .accounts({
        buyerInTokenAccount: buyerOniTokenAccount.address,
        buyerOutTokenAccount: buyerUsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer.publicKey,
        oniVault: oniVaultPda,
        mudVault: mudVaultPda,
        usturVault: usturVaultPda,
        proceedsVault: proceedsVaultPda,
      })
      .signers([buyer])
      .rpc();

    await program.methods
      .swap({ mud: {} })
      .accounts({
        buyerInTokenAccount: buyerMudTokenAccount.address,
        buyerOutTokenAccount: buyerUsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer.publicKey,
        oniVault: oniVaultPda,
        mudVault: mudVaultPda,
        usturVault: usturVaultPda,
        proceedsVault: proceedsVaultPda,
      })
      .signers([buyer])
      .rpc();

    await program.methods
      .swap({ ustur: {} })
      .accounts({
        buyerInTokenAccount: buyerUsturTokenAccount.address,
        buyerOutTokenAccount: buyerUsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer.publicKey,
        oniVault: oniVaultPda,
        mudVault: mudVaultPda,
        usturVault: usturVaultPda,
        proceedsVault: proceedsVaultPda,
      })
      .signers([buyer])
      .rpc();

    const usdcBalance = await programProvider.connection.getTokenAccountBalance(
      buyerUsdcTokenAccount.address
    );

    const oniTokenBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyerOniTokenAccount.address
      );

    const mudTokenBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyerMudTokenAccount.address
      );

    const usturTokenBalance =
      await programProvider.connection.getTokenAccountBalance(
        buyerUsturTokenAccount.address
      );

    let proceedsVaultBalance =
      await programProvider.connection.getTokenAccountBalance(proceedsVaultPda);

    expect(oniTokenBalance.value.uiAmount).eq(1);
    expect(mudTokenBalance.value.uiAmount).eq(1);
    expect(usturTokenBalance.value.uiAmount).eq(1);
    expect(usdcBalance.value.uiAmount).eq(1000 - price * 3);
    expect(proceedsVaultBalance.value.uiAmount).eq(price * 3);

    const proceedsTokenAccount = await getOrCreateAssociatedTokenAccount(
      programProvider.connection,
      mintOwner,
      usdcMint,
      owner.publicKey
    );

    await program.methods
      .withdrawProceeds()
      .accounts({
        state: stateAccount.publicKey,
        proceedsVault: proceedsVaultPda,
        ownerInTokenAccount: proceedsTokenAccount.address,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    proceedsVaultBalance =
      await programProvider.connection.getTokenAccountBalance(proceedsVaultPda);

    const ownerProceedsBalance =
      await programProvider.connection.getTokenAccountBalance(
        proceedsTokenAccount.address
      );

    expect(proceedsVaultBalance.value.uiAmount).eq(0);
    expect(ownerProceedsBalance.value.uiAmount).eq(price * 3);
  });

  it("explode if delinquent tries to withdraw", async () => {
    const owner = anchor.web3.Keypair.generate();
    const delinquent = anchor.web3.Keypair.generate();

    const price = 15;

    const faction = { oni: {} };

    const {
      stateAccount,
      oniVaultPda,
      mudVaultPda,
      usturVaultPda,
      proceedsVaultPda,
      oniMint,
      usdcMint,
      mintOwner,
    } = await setupAndArm(program, owner, price * Math.pow(10, 6));
    const buyer = anchor.web3.Keypair.generate();

    const {
      buyerUsdcTokenAccount,
      buyerOtherTokenAccount: buyerOniTokenAccount,
    } = await setupBuyerAccounts(program, buyer, mintOwner, usdcMint, oniMint);

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
      .swap(faction)
      .accounts({
        buyerInTokenAccount: buyerOniTokenAccount.address,
        buyerOutTokenAccount: buyerUsdcTokenAccount.address,
        state: stateAccount.publicKey,
        buyer: buyer.publicKey,
        oniVault: oniVaultPda,
        mudVault: mudVaultPda,
        usturVault: usturVaultPda,
        proceedsVault: proceedsVaultPda,
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
        })
        .signers([delinquent])
        .rpc();
    } catch (e) {
      expect((e as AnchorError).error.errorCode.code).eq("ConstraintHasOne");
    }
  });
});
