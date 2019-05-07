#include <atomic>
#include <thread>
#include <cstdio>
#include <cassert>

#include "future.h"
#include "utils.h"
// #include <v8.h>

// #include "Version.h"
// #include <foundationdb/fdb_c.h>

#include "FdbError.h"
#include "future.h"

static napi_threadsafe_function tsf;
static int num_outstanding = 0;



template<class T> struct CtxBase {
  FDBFuture *future;
  void (*fn)(napi_env, FDBFuture*, T*);
};

static void trigger(napi_env env, napi_value _js_callback, void* _context, void* data) {
  CtxBase<void>* ctx = static_cast<CtxBase<void>*>(data);

  if (env != NULL) {
    --num_outstanding;
    if (num_outstanding == 0) {
      assert(0 == napi_unref_threadsafe_function(env, tsf));
    }

    ctx->fn(env, ctx->future, ctx);
  }

  fdb_future_destroy(ctx->future);
}

napi_value unused_func;

// napi_create_threadsafe_function requires that we pass a JS function argument.
// The function is never called, but we still need to pass one anyway:
// See https://github.com/nodejs/node/issues/27592
napi_value unused(napi_env, napi_callback_info) {
  assert(0);
}

napi_status initFuture(napi_env env) {
  char name[] = "unused_panic";
  NAPI_OK_OR_RETURN_STATUS(env, napi_create_function(env, name, sizeof(name), unused, NULL, &unused_func));

  char resource_name[] = "fdbfuture";
  napi_value str;
  NAPI_OK_OR_RETURN_STATUS(env, napi_create_string_utf8(env, resource_name, sizeof(resource_name), &str));
  NAPI_OK_OR_RETURN_STATUS(env,
    napi_create_threadsafe_function(env, unused_func, NULL, str, 16, 1, NULL, NULL, NULL, trigger, &tsf)
  );

  // NAPI_OK_OR_RETURN_STATUS(env, napi_ref_threadsafe_function(env, tsf));
  return napi_ok;
}

// unused cleanup.
void closeFuture(napi_env env) {
  napi_release_threadsafe_function(tsf, napi_tsfn_abort);
}


template<class T> static napi_status resolveFutureInMainLoop(napi_env env, FDBFuture *f, T* ctx, void (*fn)(napi_env env, FDBFuture *f, T*)) {
  // printf("resolveFutureInMainLoop called\n");
  ctx->future = f;
  ctx->fn = fn;

  // Prevent node from closing until the future has resolved.
  // NAPI_OK_OR_RETURN_STATUS(env, napi_ref_threadsafe_function(env, tsf));

  if (num_outstanding == 0) {
    NAPI_OK_OR_RETURN_STATUS(env, napi_ref_threadsafe_function(env, tsf));
  }
  num_outstanding++;

  assert(0 == fdb_future_set_callback(f, [](FDBFuture *f, void *_ctx) {
    // raise(SIGTRAP);
    T* ctx = static_cast<T*>(_ctx);
    assert(napi_ok == napi_call_threadsafe_function(tsf, ctx, napi_tsfn_blocking));
  }, ctx));

  return napi_ok;
}


MaybeValue fdbFutureToJSPromise(napi_env env, FDBFuture *f, ExtractValueFn *extractFn) {
  // Using inheritance here because Persistent doesn't seem to like being
  // copied, and this avoids another allocation & indirection.
  struct Ctx: CtxBase<Ctx> {
    napi_deferred deferred;
    ExtractValueFn *extractFn;
  };
  Ctx *ctx = new Ctx;
  ctx->extractFn = extractFn;

  napi_value promise;
  NAPI_OK_OR_RETURN_MAYBE(env, napi_create_promise(env, &ctx->deferred, &promise));

  napi_status status = resolveFutureInMainLoop<Ctx>(env, f, ctx, [](napi_env env, FDBFuture *f, Ctx *ctx) {
    fdb_error_t errcode = 0;
    MaybeValue value = ctx->extractFn(env, f, &errcode);

    if (errcode != 0) {
      napi_value err;
      assert(napi_ok == wrap_fdb_error(env, errcode, &err));
      napi_reject_deferred(env, ctx->deferred, err);
    } else if (value.status != napi_ok) {
      napi_value err;
      assert(napi_ok == napi_get_and_clear_last_exception(env, &err));
      assert(napi_ok == napi_reject_deferred(env, ctx->deferred, err));
    } else {
      napi_resolve_deferred(env, ctx->deferred, value.value);
    }

    // Needed to work around a bug where the promise doesn't actually resolve.
    // isolate->RunMicrotasks();
  });

  if (status != napi_ok) {
    napi_resolve_deferred(env, ctx->deferred, NULL); // free the promise
    delete ctx;
    return wrap_err(status);
  } else return wrap_ok(promise);
}

MaybeValue fdbFutureToCallback(napi_env env, FDBFuture *f, napi_value cbFunc, ExtractValueFn *extractFn) {
  struct Ctx: CtxBase<Ctx> {
    napi_ref cbFunc;
    ExtractValueFn *extractFn;
  };
  Ctx *ctx = new Ctx;

  NAPI_OK_OR_RETURN_MAYBE(env, napi_create_reference(env, cbFunc, 1, &ctx->cbFunc));
  ctx->extractFn = extractFn;

  napi_status status = resolveFutureInMainLoop<Ctx>(env, f, ctx, [](napi_env env, FDBFuture *f, Ctx *ctx) {
    fdb_error_t errcode = 0;
    MaybeValue value = ctx->extractFn(env, f, &errcode);

    napi_value args[2] = {}; // (err, value).
    if (errcode != 0) assert(napi_ok == wrap_fdb_error(env, errcode, &args[0]));
    else if (value.status != napi_ok) assert(napi_ok == napi_get_and_clear_last_exception(env, &args[0]));
    else args[1] = value.value;

    napi_value callback;
    assert(napi_ok == napi_get_reference_value(env, ctx->cbFunc, &callback));

    // If this throws it'll bubble up to the node uncaught exception handler, which is what we want.
    napi_call_function(env, NULL, callback, 2, args, NULL);

    napi_reference_unref(env, ctx->cbFunc, NULL);
  });
  return wrap_err(status);
}

MaybeValue futureToJS(napi_env env, FDBFuture *f, napi_value cbOrNull, ExtractValueFn *extractFn) {
  napi_valuetype type;
  NAPI_OK_OR_RETURN_MAYBE(env, typeof_wrap(env, cbOrNull, &type));
  if (type == napi_undefined || type == napi_null) {
    return fdbFutureToJSPromise(env, f, extractFn);
  } else if (type == napi_function) {
    return fdbFutureToCallback(env, f, cbOrNull, extractFn);
  } else {
    return wrap_err(napi_throw_error(env, "", "Invalid callback argument call"));
  }
}


// // *** Watch

// // This seems overcomplicated, and I'd love to be able to use the functions
// // above to do all this work. The problem is that fdb_future_cancel causes an
// // abort() if the future has already resolved. So the JS object needs to
// // somehow know that the promise has resolved. So I really want to hold a
// // reference to the JS object. And its hard to strongarm the functions above
// // into doing that. Doing it the way I am here is fine, but it means the API
// // we expose to javascript either works with promises or callbacks but not
// // both. I might end up redesigning some of this once I've benchmarked how
// // promises perform in JS & C.
// static Nan::Persistent<v8::Function> watchConstructor;

// static void Cancel(const Nan::FunctionCallbackInfo<v8::Value>& info) {
//   Local<Object> t = info.This();
//   FDBFuture *future = (FDBFuture *)(t->GetAlignedPointerFromInternalField(0));
//   if (future) fdb_future_cancel(future);
// }

// void initWatch() {
//   Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>();

//   tpl->SetClassName(Nan::New<v8::String>("Watch").ToLocalChecked());
//   tpl->InstanceTemplate()->SetInternalFieldCount(1);

//   Nan::SetPrototypeMethod(tpl, "cancel", Cancel);

//   watchConstructor.Reset(tpl->GetFunction());
// }

// Local<Object> watchFuture(FDBFuture *f, bool ignoreStandardErrors) {
//   struct Ctx: CtxBase<Ctx> {
//     Nan::Persistent<Object> jsWatch;
//     // I probably don't need to store a persistant reference here since it
//     // can't be GCed anyway because its stored on jsWatch. But I think this is
//     // *more* correct..?
//     Nan::Persistent<Promise::Resolver> resolver;
//     bool ignoreStandardErrors;
//   };
//   Ctx *ctx = new Ctx;

//   v8::Isolate *isolate = v8::Isolate::GetCurrent();

//   auto resolver = Promise::Resolver::New(isolate->GetCurrentContext()).ToLocalChecked();
//   ctx->resolver.Reset(resolver);

//   Local<Function> localCon = Local<Function>::New(isolate, watchConstructor);
//   Local<Object> jsWatch = Nan::NewInstance(localCon).ToLocalChecked();

//   jsWatch->SetAlignedPointerInInternalField(0, f);
//   // I'm sure there's a better way to attach this, but I can figure that out when moving to N-API.
//   jsWatch->Set(String::NewFromUtf8(isolate, "promise", String::kInternalizedString), resolver->GetPromise());

//   ctx->jsWatch.Reset(jsWatch);
//   ctx->ignoreStandardErrors = ignoreStandardErrors;

//   resolveFutureInMainLoop<Ctx>(f, ctx, [](FDBFuture *f, Ctx *ctx) {
//     // This is cribbed from fdbFutureToJSPromise above. Bleh.
//     Nan::HandleScope scope;
//     v8::Isolate *isolate = v8::Isolate::GetCurrent();
//     auto context = isolate->GetCurrentContext();

//     fdb_error_t err = fdb_future_get_error(ctx->future);
//     bool success = true;

//     auto resolver = Nan::New(ctx->resolver);

//     // You can no longer cancel the watcher. Remove the reference to the
//     // future, which is about to be destroyed.
//     Local<Object> jsWatch = Local<Object>::New(isolate, ctx->jsWatch);
//     jsWatch->SetAlignedPointerInInternalField(0, NULL);

//     // By default node promises will crash the whole process. If the
//     // transaction which created this watch promise is cancelled or conflicts,
//     // what should we do here? 
//     // 1 If we reject the promise, the process will crash by default.
//     //   Preventing this with the current API is really awkward
//     // 2 If we resolve the promise that doesn't really make a lot of sense
//     // 3 If we leave the promise dangling.. that sort of violates the idea of a
//     //   *promise*
//     // 
//     // By default I'm going to do option 2 (well, when ignoreStandardErrors is
//     // passed, which happens by default).
//     // 
//     // The promise will resolve (true) normally, or (false) if it was aborted.
//     if (err && ctx->ignoreStandardErrors && (
//         err == 1101 // operation_cancelled
//         || err == 1025 // transaction_cancelled
//         || err == 1020)) { // not_committed (tn conflict)
//       success = false;
//       err = 0;
//     }

//     if (err != 0) (void)resolver->Reject(context, FdbError::NewInstance(err));
//     else (void)resolver->Resolve(context, Boolean::New(isolate, success));

//     // Needed to kick promises resolved in the callback.
//     isolate->RunMicrotasks();

//     ctx->jsWatch.Reset();
//     ctx->resolver.Reset();
//   });

//   return jsWatch;
// }
