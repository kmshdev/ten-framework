from ten_runtime import (
    Addon,
    register_addon_as_extension,
    TenEnv,
)


@register_addon_as_extension("superyou_tools_python")
class SuperYouToolsExtensionAddon(Addon):

    def on_create_instance(self, ten_env: TenEnv, name: str, context) -> None:
        from .extension import SuperYouToolsExtension

        ten_env.log_info("SuperYouToolsExtensionAddon on_create_instance")
        ten_env.on_create_instance_done(SuperYouToolsExtension(name), context)
