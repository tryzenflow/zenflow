import { Module } from "@nestjs/common";
import { CryptoService } from "./crypto.service";
import { MasterKeyService } from "./master-key.service";

@Module({
  providers: [CryptoService, MasterKeyService],
  exports: [CryptoService, MasterKeyService],
})
export class CryptoModule {}
