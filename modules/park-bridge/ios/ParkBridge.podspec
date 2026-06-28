Pod::Spec.new do |s|
  s.name           = 'ParkBridge'
  s.version        = '1.0.0'
  s.summary        = 'Bridges the Supabase session, config, and car list to the native Park Car App Intent.'
  s.description    = 'Writes auth tokens (keychain, after-first-unlock), Supabase config, and the car list (UserDefaults) into shared on-device storage that the background Park Car App Intent reads.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
