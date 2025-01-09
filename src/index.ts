import {
  EventSchemas,
  Inngest,
  InngestMiddleware,
  NonRetriableError,
} from 'inngest';
import { serve } from 'inngest/cloudflare';

interface Env {
  FUNCTION_OUTPUT: KVNamespace;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/inngest')) {
      return serve({
        client: inngest,
        functions: [inngestFn],
        // @ts-expect-error
      })(request, env, ctx);
    }

    const { ids: eventIds } = await inngest.send([
      {
        name: 'app/some-event',
        data: {
          errorSource: 'step',
          causeType: 'error',
          message: 'some error class message (from step)',
        },
      },
      {
        name: 'app/some-event',
        data: {
          errorSource: 'step',
          causeType: 'object',
          message: 'some object message (from step)',
        },
      },
      {
        name: 'app/some-event',
        data: {
          errorSource: 'function',
          causeType: 'error',
          message: 'some error class message (from function)',
        },
      },
      {
        name: 'app/some-event',
        data: {
          errorSource: 'function',
          causeType: 'object',
          message: 'some object message (from function)',
        },
      },
    ]);

    for (;;) {
      const outputs = await Promise.all(
        eventIds.map((id) => env.FUNCTION_OUTPUT.get(id, 'json')),
      );

      if (!outputs.every((a) => !!a)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      return new Response(JSON.stringify(outputs, null, 2), {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;

const inngest = new Inngest({
  id: 'some-id',
  schemas: new EventSchemas().fromRecord<{
    'app/some-event': {
      data: {
        causeType: 'object' | 'error';
        errorSource: 'step' | 'function';
        message: string;
      };
    };
  }>(),
  // So we can access the env in the middleware
  middleware: [
    new InngestMiddleware({
      name: 'EnvironmentMiddleware',
      init: () => ({
        onFunctionRun: async ({ reqArgs }) => {
          const [_req, env, _ctx] = reqArgs;
          return {
            transformInput: () => {
              return {
                ctx: {
                  env: env as Env,
                },
              };
            },
          };
        },
      }),
    }),
  ],
});

const inngestFn = inngest.createFunction(
  // config
  {
    id: 'some-function',
    onFailure: async ({ event, env }) => {
      const eventData = event.data;

      const inputEvent = event.data.event;
      const inputEventData = inputEvent.data;

      const output = {
        errorSource: inputEventData.errorSource,
        causeType: inputEventData.causeType,
        expectedEventErrorCauseMessage: inputEventData.message,
        actualEventErrorCauseMessage: eventData.error.cause ?? null,
        // @ts-expect-error for some reason `result` is not in the type
        actualResultCauseMessage: eventData.result?.cause?.message,
      };

      await env.FUNCTION_OUTPUT.put(
        inputEvent.id ?? '',
        JSON.stringify(output),
      );
      return output;
    },
  },
  // trigger (event or cron)
  { event: 'app/some-event' },
  // handler function
  async ({ event, step }) => {
    if (event.data.errorSource === 'function') {
      if (event.data.causeType === 'error')
        throw new NonRetriableError('Some inngest error', {
          cause: new Error(event.data.message),
        });

      if (event.data.causeType === 'object')
        throw new NonRetriableError('Some inngest error', {
          cause: { message: event.data.message },
        });
    }

    if (event.data.errorSource === 'step') {
      await step.run('some-step', () => {
        if (event.data.causeType === 'error')
          throw new NonRetriableError('Some inngest error', {
            cause: new Error(event.data.message),
          });

        if (event.data.causeType === 'object')
          throw new NonRetriableError('Some inngest error', {
            cause: { message: event.data.message },
          });
      });
    }
  },
);
