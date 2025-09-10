import { Module } from "@nestjs/common";
import { SchedulerController } from "./scheduler.controller";
import { ClientProxyFactory, Transport } from "@nestjs/microservices";
import { SCHEDULER_PACKAGE } from "./constants";
import { ConfigService } from "@nestjs/config";
import path from "path";
import { SchedulesModule } from "../schedules/schedules.module";
import { TasksModule } from "../tasks/tasks.module";
import { ConstraintsModule } from "../constraints/constraints.module";

@Module({
  imports: [SchedulesModule, TasksModule, ConstraintsModule],
  controllers: [SchedulerController],
  providers: [
    {
      provide: SCHEDULER_PACKAGE,
      useFactory: (configService: ConfigService) => {
        return ClientProxyFactory.create({
          transport: Transport.GRPC,
          options: {
            package: "scheduler",
            url: configService.get<string>("GRPC_SCHEDULER_URL"),
            protoPath: path.join(process.cwd(), "..", "proto/scheduler.proto"),
          },
        });
      },
      inject: [ConfigService],
    },
  ],
})
export class SchedulerModule {}
