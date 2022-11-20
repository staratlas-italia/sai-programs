import * as anchor from "@project-serum/anchor";
import { SaiCitizenship } from "../../../target/types/sai_citizenship";

export const createVaultPdas = async (
  program: anchor.Program<SaiCitizenship>,
  stateAccount: anchor.web3.PublicKey
) => {
  const [oniVaultPda] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from("oni_vault"), stateAccount.toBuffer()],
    program.programId
  );
  const [mudVaultPda] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from("mud_vault"), stateAccount.toBuffer()],
    program.programId
  );
  const [usturVaultPda] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from("ustur_vault"), stateAccount.toBuffer()],
    program.programId
  );
  const [proceedsVaultPda] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from("proceeds_vault"), stateAccount.toBuffer()],
    program.programId
  );

  return {
    oniVaultPda,
    mudVaultPda,
    usturVaultPda,
    proceedsVaultPda,
  };
};
